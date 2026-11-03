package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var (
	ErrInvalidClassID = errors.New("invalid class ID")
	ErrClassExists    = errors.New("class already exists")
	ErrClassNotFound  = errors.New("class not found")
	ErrClassInUse     = errors.New("class is in use")
	ErrClassForbidden = errors.New("class management forbidden")
	classIDPattern    = regexp.MustCompile(`^[A-Z0-9][A-Z0-9-]{1,31}$`)
)

type ClassOption struct {
	ID   string `bson:"_id"`
	Name string `bson:"name"`
}

func (s *Server) ClassOptions(ctx context.Context, role string, classIDs []string) ([]ClassOption, error) {
	filter := bson.M{}
	if role == "dosen" {
		if len(classIDs) == 0 {
			return []ClassOption{}, nil
		}
		filter["_id"] = bson.M{"$in": classIDs}
	}
	cursor, err := s.db.Collection("classes").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var classes []ClassOption
	if err := cursor.All(ctx, &classes); err != nil {
		return nil, err
	}
	return classes, nil
}

// CreateClass creates a class and adds it to the creating lecturer's scope.
func (s *Server) CreateClass(ctx context.Context, userID, role, classID, name string) error {
	classID = strings.ToUpper(strings.TrimSpace(classID))
	name = strings.TrimSpace(name)
	if !classIDPattern.MatchString(classID) || len(name) == 0 || len(name) > 120 {
		return ErrInvalidClassID
	}
	if role != "administrator" && role != "dosen" {
		return ErrClassForbidden
	}

	_, err := s.db.Collection("classes").InsertOne(ctx, bson.M{
		"_id":        classID,
		"name":       name,
		"created_at": time.Now().UTC(),
		"created_by": userID,
	})
	if mongo.IsDuplicateKeyError(err) {
		return ErrClassExists
	}
	if err != nil {
		return err
	}

	if role == "dosen" {
		result, err := s.db.Collection("users").UpdateOne(ctx,
			bson.M{"_id": userID, "role": "dosen", "active": true},
			bson.M{"$addToSet": bson.M{"class_ids": classID}},
		)
		if err == nil && result.MatchedCount == 1 {
			return nil
		}
		if err == nil {
			err = ErrClassForbidden
		}
		if _, cleanupErr := s.db.Collection("classes").DeleteOne(ctx, bson.M{"_id": classID, "created_by": userID}); cleanupErr != nil {
			log.Printf("kelas %s gagal ditetapkan ke dosen %s; rollback kelas gagal: %v", classID, userID, cleanupErr)
			return fmt.Errorf("assign class to lecturer: %w (rollback: %v)", err, cleanupErr)
		}
		return err
	}
	return nil
}

// DeleteClass blocks deletion while any operational data or another staff
// account still references the class.
func (s *Server) DeleteClass(ctx context.Context, userID, role string, classIDs []string, classID string) error {
	classID = strings.ToUpper(strings.TrimSpace(classID))
	if !classIDPattern.MatchString(classID) {
		return ErrClassNotFound
	}
	if role != "administrator" && role != "dosen" {
		return ErrClassForbidden
	}
	if role == "dosen" && !containsClassID(classIDs, classID) {
		return ErrClassForbidden
	}

	if err := s.db.Collection("classes").FindOne(ctx, bson.M{"_id": classID}).Err(); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return ErrClassNotFound
		}
		return err
	}

	references := []struct {
		collection string
		filter     bson.M
	}{
		{"students", bson.M{"class_id": classID}},
		{"class_students", bson.M{"class_id": classID}},
		{"devices", bson.M{"class_id": classID}},
		{"scan_events", bson.M{"class_id": classID}},
		{"users", bson.M{"class_ids": classID, "_id": bson.M{"$ne": userID}}},
	}
	for _, reference := range references {
		count, err := s.db.Collection(reference.collection).CountDocuments(ctx, reference.filter)
		if err != nil {
			return err
		}
		if count > 0 {
			return ErrClassInUse
		}
	}

	if role == "dosen" {
		result, err := s.db.Collection("users").UpdateOne(ctx,
			bson.M{"_id": userID, "role": "dosen", "active": true},
			bson.M{"$pull": bson.M{"class_ids": classID}},
		)
		if err != nil {
			return err
		}
		if result.MatchedCount != 1 {
			return ErrClassForbidden
		}
	}

	_, err := s.db.Collection("deleted_classes").UpdateOne(ctx,
		bson.M{"_id": classID},
		bson.M{"$set": bson.M{"deleted_at": time.Now().UTC(), "deleted_by": userID}},
		options.Update().SetUpsert(true),
	)
	if err != nil {
		if restoreErr := s.restoreClassScope(ctx, userID, role, classID); restoreErr != nil {
			log.Printf("kelas %s gagal dihapus dan penugasan dosen %s gagal dipulihkan: %v", classID, userID, restoreErr)
			return fmt.Errorf("mark class deleted: %w (restore assignment: %v)", err, restoreErr)
		}
		return err
	}

	result, err := s.db.Collection("classes").DeleteOne(ctx, bson.M{"_id": classID})
	if err != nil || result.DeletedCount == 0 {
		if restoreErr := s.restoreClassScope(ctx, userID, role, classID); restoreErr != nil {
			log.Printf("kelas %s gagal dihapus dan penugasan dosen %s gagal dipulihkan: %v", classID, userID, restoreErr)
			if err != nil {
				return fmt.Errorf("delete class: %w (restore assignment: %v)", err, restoreErr)
			}
			return fmt.Errorf("delete class: %w (restore assignment: %v)", ErrClassNotFound, restoreErr)
		}
		if err != nil {
			return err
		}
		return ErrClassNotFound
	}
	log.Printf("kelas %s dihapus oleh staf %s", classID, userID)
	return nil
}

func (s *Server) restoreClassScope(ctx context.Context, userID, role, classID string) error {
	if role != "dosen" {
		return nil
	}
	_, err := s.db.Collection("users").UpdateOne(ctx,
		bson.M{"_id": userID, "role": "dosen", "active": true},
		bson.M{"$addToSet": bson.M{"class_ids": classID}},
	)
	return err
}

func containsClassID(classIDs []string, classID string) bool {
	for _, id := range classIDs {
		if strings.EqualFold(id, classID) {
			return true
		}
	}
	return false
}

func ClassManagementErrorMessage(err error) string {
	switch {
	case errors.Is(err, ErrInvalidClassID):
		return "ID kelas harus 2–32 karakter: huruf, angka, dan tanda hubung; nama kelas maksimal 120 karakter."
	case errors.Is(err, ErrClassExists):
		return "ID kelas sudah digunakan."
	case errors.Is(err, ErrClassNotFound):
		return "Kelas tidak ditemukan."
	case errors.Is(err, ErrClassInUse):
		return "Kelas tidak dapat dihapus karena masih digunakan oleh mahasiswa, perangkat, riwayat, atau akun staf lain."
	case errors.Is(err, ErrClassForbidden):
		return "Anda tidak memiliki izin untuk mengelola kelas ini."
	default:
		return "Pengelolaan kelas gagal. Silakan coba kembali."
	}
}
