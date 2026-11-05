// Entry point frontend.
// Seluruh halaman sudah dirender server + htmx, jadi tidak ada lagi modul
// per-halaman di sini; file ini hanya menyiapkan htmx dan perilaku global.
import { refreshIcons, toast } from './lib/ui.js';

refreshIcons();

let studentCreationRefreshPending = false;
let studentDialogGeneration = 0;
let faceCameraStream = null;
let faceCameraNim = '';
let faceCameraEnrollURL = '';
let faceCapturedFiles = [];
let faceCameraGeneration = 0;
let facePhotoCapturePending = false;
let faceEnrollmentPending = false;
let faceCameraPermissionRequest = null;

const faceCameraDialog = document.querySelector('#faceEnrollmentDialog');
const faceCameraVideo = document.querySelector('#faceCameraVideo');
const faceCameraStatus = document.querySelector('#faceCameraStatus');
const faceCameraSelect = document.querySelector('#faceCameraSelect');
const faceCapturePreview = document.querySelector('#faceCapturePreview');
const faceCaptureButton = document.querySelector('#faceCaptureButton');
const faceUndoCapture = document.querySelector('#faceUndoCapture');
const faceSubmitEnrollment = document.querySelector('#faceSubmitEnrollment');

function updateFaceCameraControls() {
  if (!faceCaptureButton || !faceUndoCapture || !faceSubmitEnrollment) return;
  const cameraReady = Boolean(faceCameraStream);
  faceCaptureButton.disabled = !cameraReady || faceEnrollmentPending || facePhotoCapturePending || faceCapturedFiles.length >= 6;
  faceUndoCapture.disabled = faceEnrollmentPending || faceCapturedFiles.length === 0;
  faceSubmitEnrollment.disabled = faceEnrollmentPending || faceCapturedFiles.length === 0;
  faceCameraSelect.disabled = faceEnrollmentPending || faceCameraSelect.options.length < 2;
  faceCameraDialog?.querySelectorAll('[data-face-camera-close]').forEach((button) => {
    button.disabled = faceEnrollmentPending;
  });
}

function clearFaceCaptures() {
  faceCapturePreview?.querySelectorAll('[data-preview-url]').forEach((preview) => {
    URL.revokeObjectURL(preview.dataset.previewUrl);
  });
  if (faceCapturePreview) faceCapturePreview.replaceChildren();
  faceCapturedFiles = [];
  updateFaceCameraControls();
}

function stopFaceCamera() {
  faceCameraGeneration += 1;
  faceCameraStream?.getTracks().forEach((track) => track.stop());
  faceCameraStream = null;
  if (faceCameraVideo) faceCameraVideo.srcObject = null;
  faceCameraNim = '';
  faceCameraEnrollURL = '';
  faceEnrollmentPending = false;
  clearFaceCaptures();
  if (faceCameraStatus) faceCameraStatus.textContent = 'Izinkan akses kamera untuk memulai.';
}

function requestFaceCameraPermissionOnStudentsPage() {
  if (document.body.dataset.page !== 'mahasiswa' || document.body.dataset.role !== 'administrator') return null;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Kamera memerlukan HTTPS dan browser yang mendukung akses kamera.', true);
    return null;
  }
  if (faceCameraPermissionRequest) return faceCameraPermissionRequest;
  faceCameraPermissionRequest = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'user' } },
  }).then((stream) => {
    stream.getTracks().forEach((track) => track.stop());
    return true;
  }).catch((error) => {
    const message = error.name === 'NotAllowedError'
      ? 'Izin kamera belum diberikan. Izinkan kamera di browser agar enrollment wajah dapat digunakan.'
      : error.name === 'NotFoundError'
        ? 'Tidak ditemukan kamera pada perangkat ini.'
        : error.message || 'Kamera gagal diakses.';
    toast(message, true);
    return false;
  });
  return faceCameraPermissionRequest;
}

async function startFaceCamera(deviceId = '', generation = faceCameraGeneration) {
  const video = faceCameraVideo;
  if (!video || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Kamera tidak tersedia. Buka halaman melalui HTTPS atau localhost dan gunakan browser yang mendukung kamera.');
  }
  const videoConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'user' } }),
  };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  if (generation !== faceCameraGeneration || !faceCameraDialog?.open) {
    stream.getTracks().forEach((track) => track.stop());
    return false;
  }
  const previousStream = faceCameraStream;
  faceCameraStream = stream;
  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    if (generation === faceCameraGeneration) {
      faceCameraStream = previousStream;
      video.srcObject = previousStream;
    }
    throw error;
  }
  if (generation !== faceCameraGeneration || !faceCameraDialog?.open) {
    stream.getTracks().forEach((track) => track.stop());
    return false;
  }
  previousStream?.getTracks().forEach((track) => track.stop());
  updateFaceCameraControls();
  return true;
}

async function loadFaceCameraOptions() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  faceCameraSelect.replaceChildren();
  cameras.forEach((camera, index) => {
    const option = document.createElement('option');
    option.value = camera.deviceId;
    option.textContent = camera.label || `Kamera ${index + 1}`;
    faceCameraSelect.append(option);
  });
  const activeDeviceId = faceCameraStream?.getVideoTracks()[0]?.getSettings().deviceId;
  if (activeDeviceId) faceCameraSelect.value = activeDeviceId;
  faceCameraSelect.disabled = cameras.length < 2;
}

async function openFaceEnrollment(button) {
  const nim = button.dataset.studentNim;
  const enrollURL = button.dataset.enrollUrl;
  if (!faceCameraDialog || !enrollURL) {
    toast('Kontrol kamera enrollment tidak tersedia. Muat ulang halaman dan coba lagi.', true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Akses kamera memerlukan HTTPS (atau localhost) dan browser yang mendukung kamera.', true);
    return;
  }

  const generation = ++faceCameraGeneration;
  clearFaceCaptures();
  faceCameraNim = nim;
  faceCameraEnrollURL = enrollURL;
  document.querySelector('#faceEnrollmentStudent').textContent = `Mahasiswa NIM ${nim}`;
  faceCameraSelect.disabled = true;
  faceCameraSelect.replaceChildren(new Option('Memuat kamera...', ''));
  faceCameraStatus.textContent = 'Meminta izin akses kamera...';
  faceCameraDialog.showModal();
  try {
    await faceCameraPermissionRequest;
    if (generation !== faceCameraGeneration) return;
    const started = await startFaceCamera('', generation);
    if (!started || generation !== faceCameraGeneration) return;
    await loadFaceCameraOptions();
    if (generation !== faceCameraGeneration) return;
    faceCameraStatus.textContent = 'Kamera siap. Ambil 1–6 foto dengan pose berbeda.';
  } catch (error) {
    if (generation !== faceCameraGeneration) return;
    const message = error.name === 'NotAllowedError'
      ? 'Izin kamera ditolak. Izinkan kamera di pengaturan browser lalu coba lagi.'
      : error.name === 'NotFoundError'
        ? 'Tidak ditemukan kamera pada perangkat ini.'
        : error.message || 'Kamera gagal dibuka.';
    faceCameraStatus.textContent = message;
    toast(message, true);
  }
}

async function captureFacePhoto() {
  if (facePhotoCapturePending) return;
  if (!faceCameraStream || !faceCameraEnrollURL || !faceCameraVideo.videoWidth) {
    faceCameraStatus.textContent = 'Kamera belum siap. Tunggu pratinjau video, lalu coba lagi.';
    return;
  }
  const generation = faceCameraGeneration;
  const nim = faceCameraNim;
  facePhotoCapturePending = true;
  updateFaceCameraControls();
  try {
    const scale = Math.min(1, 1280 / faceCameraVideo.videoWidth, 720 / faceCameraVideo.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(faceCameraVideo.videoWidth * scale);
    canvas.height = Math.round(faceCameraVideo.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      toast('Browser gagal menyiapkan pemrosesan foto. Coba browser lain atau ambil ulang.', true);
      return;
    }
    context.drawImage(faceCameraVideo, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      toast('Foto dari kamera gagal diproses. Coba ambil ulang.', true);
      return;
    }
    if (generation !== faceCameraGeneration || !faceCameraDialog?.open) return;
    const number = faceCapturedFiles.length + 1;
    const file = new File([blob], `${nim}-${String(number).padStart(2, '0')}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
    const url = URL.createObjectURL(file);
    const preview = document.createElement('div');
    preview.className = 'face-capture-item';
    preview.dataset.previewUrl = url;
    const image = document.createElement('img');
    image.src = url;
    image.alt = `Foto enrollment ke-${number}`;
    const label = document.createElement('span');
    label.textContent = `Foto ${number}`;
    preview.append(image, label);
    faceCapturePreview.append(preview);
    faceCapturedFiles.push(file);
    faceCameraStatus.textContent = `Foto ${number} dari 6 tersimpan. Ubah pose sebelum mengambil foto berikutnya.`;
  } finally {
    facePhotoCapturePending = false;
    updateFaceCameraControls();
  }
}

function dispatchResponseTriggers(response) {
  const header = response.headers.get('HX-Trigger');
  if (!header) return {};
  const triggers = JSON.parse(header);
  Object.entries(triggers).forEach(([name, detail]) => {
    htmx.trigger(document.body, name, detail === true ? {} : detail);
  });
  return triggers;
}

function refreshStudentRoster(filters, rosterRegion, markerHeader) {
  let cleanup;
  const settled = new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      cleanup?.();
      callback(value);
    };
    const matchesRequest = (event) =>
      event.detail?.target === rosterRegion &&
      event.detail?.requestConfig?.headers?.[markerHeader] === 'true';
    const onSettle = (event) => {
      if (matchesRequest(event)) finish(resolve);
    };
    const onError = (event) => {
      if (matchesRequest(event)) finish(reject, new Error('Roster request failed'));
    };
    const timer = window.setTimeout(() => finish(reject, new Error('Roster request timed out')), 30000);
    cleanup = () => {
      window.clearTimeout(timer);
      document.body.removeEventListener('htmx:afterSettle', onSettle);
      document.body.removeEventListener('htmx:responseError', onError);
      document.body.removeEventListener('htmx:sendError', onError);
      document.body.removeEventListener('htmx:timeout', onError);
    };
    document.body.addEventListener('htmx:afterSettle', onSettle);
    document.body.addEventListener('htmx:responseError', onError);
    document.body.addEventListener('htmx:sendError', onError);
    document.body.addEventListener('htmx:timeout', onError);
  });

  const request = window.htmx.ajax('GET', '/partials/mahasiswa', {
    source: filters,
    target: rosterRegion,
    swap: 'innerHTML',
    headers: { [markerHeader]: 'true' },
    timeout: 25000,
  });
  return Promise.all([request, settled]);
}

async function submitFaceEnrollment() {
  if (faceEnrollmentPending || !faceCameraEnrollURL || faceCapturedFiles.length < 1 || faceCapturedFiles.length > 6) return;
  const filters = document.querySelector('#studentFilters');
  const rosterRegion = document.querySelector('#rosterRegion');
  if (!filters || !rosterRegion || !window.htmx) {
    toast('Roster tidak tersedia. Muat ulang halaman sebelum mengirim enrollment.', true);
    return;
  }

  const formData = new FormData();
  faceCapturedFiles.forEach((file) => formData.append('images', file, file.name));
  const query = new URLSearchParams(new FormData(filters));
  const url = new URL(faceCameraEnrollURL, window.location.origin);
  url.search = query.toString();
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
  faceEnrollmentPending = true;
  updateFaceCameraControls();
  faceCameraStatus.textContent = `Mengirim ${faceCapturedFiles.length} foto untuk NIM ${faceCameraNim}...`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
      headers: {
        'HX-Request': 'true',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
    });
    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }
    const triggers = dispatchResponseTriggers(response);
    if (!response.ok) {
      throw new Error(`Server menolak enrollment (HTTP ${response.status}).`);
    }

    const enrollmentError = Boolean(triggers.toast?.error);
    try {
      await refreshStudentRoster(filters, rosterRegion, 'X-Student-Enrollment-Refresh');
    } catch {
      if (!enrollmentError) {
        faceCameraDialog.close();
        toast('Enrollment sudah dikirim, tetapi roster gagal diperbarui. Muat ulang halaman untuk memastikan statusnya.', true);
        return;
      }
    }

    if (!enrollmentError) faceCameraDialog.close();
    else faceCameraStatus.textContent = 'Enrollment gagal. Periksa notifikasi, lalu ambil ulang foto atau kirim kembali.';
  } catch (error) {
    const message = error.message || 'Koneksi terputus saat mengirim enrollment.';
    faceCameraStatus.textContent = `${message} Foto tetap tersimpan; Anda dapat mencoba kembali.`;
    toast(message, true);
  } finally {
    faceEnrollmentPending = false;
    updateFaceCameraControls();
  }
}

// Integrasi htmx: matikan eval (kompatibel dengan CSP script-src 'self'),
// sisipkan token CSRF pada setiap request htmx, dan segarkan ikon Lucide
// setelah fragment HTML ditukar.
const htmx = window.htmx;
if (htmx) {
  htmx.config.allowEval = false;
  document.body.addEventListener('htmx:configRequest', (event) => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    if (csrfToken) event.detail.headers['X-CSRF-Token'] = csrfToken;
  });
  document.body.addEventListener('htmx:beforeRequest', (event) => {
    const request = event.detail;
    const isStudentCreatedRefresh =
      request.requestConfig?.headers?.['X-Student-Created-Refresh'] === 'true';
    if (studentCreationRefreshPending &&
        request.elt === document.querySelector('#studentFilters') &&
        !isStudentCreatedRefresh) {
      event.preventDefault();
    }
  });

  document.body.addEventListener('htmx:responseError', (event) => {
    if (event.detail.xhr.status === 401) window.location.assign('/login');
  });
  const syncActiveNavigation = () => {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.sidebar > .nav-list .nav-link').forEach((link) => {
      const active = link.pathname === currentPath && link.hash === '';
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };
  document.body.addEventListener('htmx:afterSwap', () => {
    refreshIcons();
    syncActiveNavigation();
    document.body.dataset.page = document.querySelector('#main-content')?.dataset.page ?? document.body.dataset.page;
  });
  document.body.addEventListener('htmx:historyRestore', syncActiveNavigation);
}

// Event yang dipancarkan server lewat header HX-Trigger.
document.body.addEventListener('toast', (event) => {
  toast(event.detail?.message ?? '', Boolean(event.detail?.error));
});
document.body.addEventListener('student-created', async (event) => {
  const filters = document.querySelector('#studentFilters');
  const rosterRegion = document.querySelector('#rosterRegion');
  const dialog = document.querySelector('#studentDialog');
  const dialogGeneration = studentDialogGeneration;
  const form = document.querySelector('#studentForm');
  studentCreationRefreshPending = true;
  if (!filters || !rosterRegion || !dialog || !window.htmx) {
    studentCreationRefreshPending = false;
    toast('Mahasiswa tersimpan, tetapi roster tidak dapat dimuat ulang. Muat ulang halaman sebelum enrollment.', true);
    if (studentDialogGeneration === dialogGeneration && dialog?.open) dialog.close();
    return;
  }

  form?.querySelector('[type="submit"]')?.setAttribute('disabled', '');
  const search = filters.querySelector('[name="q"]');
  const classFilter = filters.querySelector('[name="class"]');
  if (search) search.value = '';
  if (classFilter) classFilter.value = 'all';

  const path = '/partials/mahasiswa';
  const refreshHeader = 'X-Student-Created-Refresh';
  let cleanup;
  const rosterSettled = new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      cleanup?.();
      callback(value);
    };
    const onSettle = (settleEvent) => {
      if (settleEvent.detail?.target === rosterRegion &&
          settleEvent.detail?.requestConfig?.headers?.[refreshHeader] === 'true') finish(resolve);
    };
    const onError = (errorEvent) => {
      if (errorEvent.detail?.target === rosterRegion &&
          errorEvent.detail?.requestConfig?.headers?.[refreshHeader] === 'true') {
        finish(reject, new Error('Roster request failed'));
      }
    };
    const timer = window.setTimeout(() => finish(reject, new Error('Roster request timed out')), 30000);
    cleanup = () => {
      window.clearTimeout(timer);
      document.body.removeEventListener('htmx:afterSettle', onSettle);
      document.body.removeEventListener('htmx:responseError', onError);
      document.body.removeEventListener('htmx:sendError', onError);
      document.body.removeEventListener('htmx:timeout', onError);
    };
    document.body.addEventListener('htmx:afterSettle', onSettle);
    document.body.addEventListener('htmx:responseError', onError);
    document.body.addEventListener('htmx:sendError', onError);
    document.body.addEventListener('htmx:timeout', onError);
  });

  try {
    await Promise.all([
      window.htmx.ajax('GET', path, {
        source: filters,
        target: rosterRegion,
        swap: 'innerHTML',
        headers: { [refreshHeader]: 'true' },
        timeout: 25000,
      }),
      rosterSettled,
    ]);
    studentCreationRefreshPending = false;
    if (studentDialogGeneration === dialogGeneration && dialog.open) dialog.close();
    toast(event.detail?.message ?? 'Mahasiswa berhasil ditambahkan.');
  } catch {
    studentCreationRefreshPending = false;
    if (studentDialogGeneration === dialogGeneration && dialog.open) dialog.close();
    toast('Mahasiswa tersimpan, tetapi roster gagal dimuat ulang. Muat ulang halaman untuk memastikan mahasiswa tampil sebelum enrollment.', true);
  }
});
document.body.addEventListener('student-dialog-close', () => {
  document.querySelector('#studentDialog')?.close();
});

// Delegasi klik global supaya tetap bekerja untuk markup yang ditukar htmx.
if (faceCameraDialog) {
  faceCameraDialog.addEventListener('close', stopFaceCamera);
  faceCameraDialog.querySelectorAll('[data-face-camera-close]').forEach((button) => {
    button.addEventListener('click', () => faceCameraDialog.close());
  });
  faceCameraSelect.addEventListener('change', async () => {
    if (!faceCameraSelect.value) return;
    const generation = faceCameraGeneration;
    faceCameraStatus.textContent = 'Mengganti kamera...';
    try {
      const started = await startFaceCamera(faceCameraSelect.value, generation);
      if (!started || generation !== faceCameraGeneration) return;
      faceCameraStatus.textContent = 'Kamera siap. Ambil 1–6 foto dengan pose berbeda.';
    } catch (error) {
      if (generation !== faceCameraGeneration) return;
      const message = error.message || 'Kamera yang dipilih gagal dibuka.';
      faceCameraStatus.textContent = message;
      faceCameraSelect.value = faceCameraStream?.getVideoTracks()[0]?.getSettings().deviceId || '';
      toast(message, true);
    }
  });
  faceCaptureButton.addEventListener('click', () => {
    captureFacePhoto().catch((error) => toast(error.message || 'Foto dari kamera gagal diproses.', true));
  });
  faceUndoCapture.addEventListener('click', () => {
    const preview = faceCapturePreview.lastElementChild;
    if (!preview) return;
    URL.revokeObjectURL(preview.dataset.previewUrl);
    preview.remove();
    faceCapturedFiles.pop();
    faceCameraStatus.textContent = `Foto terakhir dihapus. Tersisa ${faceCapturedFiles.length} foto.`;
    updateFaceCameraControls();
  });
  faceSubmitEnrollment.addEventListener('click', submitFaceEnrollment);
}

document.querySelector('#studentDialog')?.addEventListener('close', () => {
  studentDialogGeneration += 1;
});

document.addEventListener('click', (event) => {
  const enrollButton = event.target.closest('.face-enroll-launch');
  if (enrollButton) {
    openFaceEnrollment(enrollButton);
    return;
  }
  if (event.target.closest('#menuToggle')) {
    document.querySelector('#sidebar')?.classList.toggle('open');
    return;
  }
  if (event.target.closest('#printReport')) {
    window.print();
    return;
  }
  if (event.target.closest('#openStudentDialog')) {
    const dialog = document.querySelector('#studentDialog');
    studentDialogGeneration += 1;
    dialog?.showModal();
    const form = dialog?.querySelector('#studentForm');
    if (form) {
      form.reset();
      form.querySelectorAll('input, select, button').forEach((control) => { control.disabled = false; });
      form.querySelectorAll('.inline-alert, .field-error').forEach((notice) => notice.remove());
    }
    return;
  }
  if (event.target.closest('#closeStudentDialog, #cancelStudentDialog')) {
    document.querySelector('#studentDialog')?.close();
  }
});

requestFaceCameraPermissionOnStudentsPage();
