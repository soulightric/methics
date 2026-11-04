// Entry point frontend.
// Seluruh halaman sudah dirender server + htmx, jadi tidak ada lagi modul
// per-halaman di sini; file ini hanya menyiapkan htmx dan perilaku global.
import { refreshIcons, toast } from './lib/ui.js';

refreshIcons();

let studentCreationRefreshPending = false;

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
      return;
    }
    const input = request.elt;
    if (!input?.matches?.('.face-enroll-upload')) return;
    const count = input.files?.length ?? 0;
    const status = input.closest('label')?.querySelector('.face-enroll-status');
    if (status) status.textContent = `Mengunggah dan memeriksa ${count} foto...`;
  });
  document.body.addEventListener('htmx:responseError', (event) => {
    if (event.detail.xhr.status === 401) window.location.assign('/login');
    const input = event.detail.elt;
    if (!input?.matches?.('.face-enroll-upload') || event.detail.xhr.status === 401) return;
    if (event.detail.xhr.getResponseHeader('HX-Trigger')) return;
    toast(`Enrollment gagal menerima hasil dari server (HTTP ${event.detail.xhr.status}). Muat ulang halaman untuk memastikan status template, lalu coba lagi.`, true);
  });
  document.body.addEventListener('htmx:sendError', (event) => {
    if (!event.detail.elt?.matches?.('.face-enroll-upload')) return;
    toast('Koneksi terputus saat enrollment. Muat ulang halaman untuk memastikan status template, lalu coba lagi.', true);
  });
  document.body.addEventListener('htmx:timeout', (event) => {
    if (!event.detail.elt?.matches?.('.face-enroll-upload')) return;
    toast('Permintaan enrollment melewati batas waktu. Muat ulang halaman untuk memastikan status template, lalu coba lagi.', true);
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
  const form = document.querySelector('#studentForm');
  studentCreationRefreshPending = true;
  if (!filters || !rosterRegion || !dialog || !window.htmx) {
    studentCreationRefreshPending = false;
    toast('Mahasiswa tersimpan, tetapi roster tidak dapat dimuat ulang. Muat ulang halaman sebelum enrollment.', true);
    dialog?.close();
    return;
  }

  form?.querySelectorAll('input, select, button').forEach((input) => { input.disabled = true; });
  const search = filters.querySelector('[name="q"]');
  const classFilter = filters.querySelector('[name="class"]');
  if (search) search.value = '';
  if (classFilter && event.detail?.classId) classFilter.value = event.detail.classId;

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
    dialog.close();
    toast(event.detail?.message ?? 'Mahasiswa berhasil ditambahkan.');
  } catch {
    studentCreationRefreshPending = false;
    dialog.close();
    toast('Mahasiswa tersimpan, tetapi roster gagal dimuat ulang. Muat ulang halaman untuk memastikan mahasiswa tampil sebelum enrollment.', true);
  }
});
document.body.addEventListener('student-dialog-close', () => {
  document.querySelector('#studentDialog')?.close();
});

// Delegasi klik global supaya tetap bekerja untuk markup yang ditukar htmx.
document.addEventListener('click', (event) => {
  if (event.target.closest('#menuToggle')) {
    document.querySelector('#sidebar')?.classList.toggle('open');
    return;
  }
  if (event.target.closest('#printReport')) {
    window.print();
    return;
  }
  if (event.target.closest('#openStudentDialog')) {
    document.querySelector('#studentDialog')?.showModal();
    return;
  }
  if (event.target.closest('#closeStudentDialog, #cancelStudentDialog')) {
    document.querySelector('#studentDialog')?.close();
  }
});
