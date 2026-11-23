const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

/* ---------- Mensajes del Service Worker (Fragmento G) ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

/* ---------- Indicador de red ---------- */
function actualizarIndicadorRed(){
  const badge = document.getElementById('badge-red');
  if (navigator.onLine) {
    badge.textContent = 'En Línea';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Sin Conexión';
    badge.className = 'badge offline';
  }
}

/* ---------- READ: pintar la bandeja ---------- */
function renderizarColaOutbox(){
  return obtenerTodosLosRegistros().then((registros) => {
    const lista = document.getElementById('lista-outbox');
    lista.innerHTML = '';

    if (registros.length === 0) {
      const vacio = document.createElement('li');
      vacio.className = 'vacio';
      vacio.textContent = 'No hay registros en la bandeja.';
      lista.appendChild(vacio);
      return;
    }

    registros.forEach((item) => {
      const li = document.createElement('li');
      const hora = new Date(item.fechaCreacion).toLocaleTimeString();
      li.className = item.estado;
      li.textContent = `${item.titulo} — ${item.estado} — ${hora}`;
      lista.appendChild(li);
    });
  });
}

/* ---------- CREATE: envío resiliente (Fragmentos B + E) ---------- */
function procesarEnvioReporte(datosFormulario){
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: datosFormulario.titulo,
      body: datosFormulario.descripcion
    })
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Detección de soporte para Background Sync API
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

/* ---------- UPDATE: fallback para navegadores sin SyncManager (Fragmento C renombrado) ---------- */
function sincronizarPendientesFallback(){
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

/* ---------- Formulario (submit) ---------- */
document.getElementById('form-incidencia').addEventListener('submit', (e) => {
  e.preventDefault();
  const formulario = e.target;

  const datos = {
    titulo: document.getElementById('titulo').value.trim(),
    descripcion: document.getElementById('descripcion').value.trim()
  };

  procesarEnvioReporte(datos)
    .then(() => {
      formulario.reset();
    })
    .catch((error) => {
      console.error('[Outbox] Error al procesar el reporte:', error);
    });
});

/* ---------- DELETE: purgar sincronizados ---------- */
document.getElementById('btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const enviados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(enviados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => {
      console.error('[Outbox] Error al purgar:', error);
    });
});

/* ---------- Eventos de red (Fragmento F) ---------- */
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Solo sincronizar desde la UI si el navegador NO soporta Background Sync (ej. Safari/iOS)
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

/* ---------- Arranque de la página ---------- */
actualizarIndicadorRed();
renderizarColaOutbox(); // READ al iniciar: rescata los registros guardados en IndexedDB

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((reg) => console.log('[SW] Registrado, scope:', reg.scope))
    .catch((err) => console.error('[SW] Error de registro:', err));
}