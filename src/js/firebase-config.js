const firebaseConfig = {
    apiKey: "AIzaSyBmQuRp81uG8XktUCyEo-XdIJ4RTta_YK4",
    authDomain: "calendario-laboral-252b1.firebaseapp.com",
    projectId: "calendario-laboral-252b1",
    storageBucket: "calendario-laboral-252b1.firebasestorage.app",
    messagingSenderId: "130172535764",
    appId: "1:130172535764:web:fc0119ba1d36b0718acc41",
    measurementId: "G-TMJ9H1T8QG"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

db.enablePersistence().catch(err => console.log("Persistencia no disponible"));

window.usuarioActual = null;
window.authMode = 'login'; 

// Función para abrir el modal en modo REGISTRO
window.mostrarRegistro = function() {
    window.authMode = 'register'; 
    document.getElementById('auth-modal').style.display = 'flex';
    document.getElementById('modal-title').textContent = 'Registrarse';
    document.getElementById('btn-auth').textContent = 'Crear Cuenta';
    document.getElementById('toggle-text').textContent = '¿Ya tienes cuenta?';
    document.getElementById('toggle-link').textContent = 'Inicia sesión aquí';
    document.getElementById('error-message').style.display = 'none';
};

// Función para abrir el modal en modo LOGIN
window.mostrarLogin = function() {
    window.authMode = 'login'; 
    document.getElementById('auth-modal').style.display = 'flex';
    document.getElementById('modal-title').textContent = 'Iniciar Sesión';
    document.getElementById('btn-auth').textContent = 'Entrar';
    document.getElementById('toggle-text').textContent = '¿No tienes cuenta?';
    document.getElementById('toggle-link').textContent = 'Regístrate aquí';
    document.getElementById('error-message').style.display = 'none';
};

window.toggleAuthMode = () => {
    window.authMode === 'login' ? window.mostrarRegistro() : window.mostrarLogin();
};

window.cerrarModal = () => document.getElementById('auth-modal').style.display = 'none';

function mostrarErrorAuth(mensaje) {
    const errorDiv = document.getElementById('error-message');
    if (!errorDiv) return;
    errorDiv.textContent = mensaje;
    errorDiv.style.display = 'block';
}

function traducirErrorGoogle(error) {
    if (!error || !error.code) return 'No se pudo iniciar sesión con Google.';

    switch (error.code) {
        case 'auth/popup-closed-by-user':
            return 'Has cerrado la ventana de Google antes de terminar el inicio de sesión.';
        case 'auth/popup-blocked':
            return 'El navegador ha bloqueado la ventana emergente de Google.';
        case 'auth/unauthorized-domain':
            return 'Este dominio no está autorizado en Firebase Auth.';
        case 'auth/operation-not-supported-in-this-environment':
            return 'Google Login necesita ejecutarse en http o https, no desde file://.';
        default:
            return error.message || 'No se pudo iniciar sesión con Google.';
    }
}

window.autenticar = () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn = document.getElementById('btn-auth');
    const errorDiv = document.getElementById('error-message');

    if (!email || !password) {
        errorDiv.textContent = "Rellena todos los campos";
        errorDiv.style.display = 'block';
        return;
    }
    
    errorDiv.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Procesando...';
    
    const isRegister = (window.authMode === 'register');

    // CORRECCIÓN: Usamos window.authMode y comparamos con 'register'
    const promise = (isRegister) 
        ? auth.createUserWithEmailAndPassword(email, password).then(u => {
            return db.collection('usuarios').doc(u.user.uid).set({ 
                email, 
                tipoCuenta: 'free', 
                fechaRegistro: new Date().toISOString(),
                ciudadActual: 'Donostia',
                sectorUsuario: 'general',
                esHosteleria: false
            });
          })
        : auth.signInWithEmailAndPassword(email, password);
    
    promise.then(() => {
        window.cerrarModal();
        btn.disabled = false;
        // LÓGICA DE CONVERSIÓN: Si se acaba de registrar y eligió Premium
        if (isRegister && planSeleccionado === 'premium') {
            setTimeout(() => {
                // Reabrimos el modal de precios para continuar con el alta premium
                if (typeof abrirModalPremium === "function") {
                    abrirModalPremium();
                }
            }, 1000);
        }
    }).catch(err => {
        errorDiv.textContent = `Error: ${err.message}`;
        errorDiv.style.display = 'block';
        btn.disabled = false;
    });
};

window.autenticarConGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    let esNuevoUsuario = false;

    auth.signInWithPopup(provider).then((result) => {
        const user = result.user;
        const userRef = db.collection('usuarios').doc(user.uid);

        return userRef.get().then((doc) => {
            if (!doc.exists) {
                esNuevoUsuario = true; // Marcamos si es nuevo para ofrecerle el Premium luego
                return userRef.set({
                    email: user.email,
                    tipoCuenta: 'free',
                    fechaRegistro: new Date().toISOString(),
                    ciudadActual: 'Donostia',
                    sectorUsuario: 'general',
                    esHosteleria: false
                });
            }
        });
    }).then(() => {
        // 1. Cerramos el modal de login
        window.cerrarModal();

        // 2. Si es nuevo y pulsó el botón de "Premium" en el muro, lanzamos los precios
        if (esNuevoUsuario && planSeleccionado === 'premium') {
            setTimeout(() => {
                if (typeof abrirModalPremium === "function") {
                    abrirModalPremium();
                }
            }, 1000);
        }
    }).catch((error) => {
        console.error("Error en Google Auth:", error);
        mostrarErrorAuth(traducirErrorGoogle(error));
    });
};

window.cerrarSesion = () => { if(confirm('¿Cerrar sesión?')) auth.signOut(); };

auth.onAuthStateChanged(user => {
    window.usuarioActual = user;
    const authButtons = document.getElementById('auth-buttons');
    const userInfo = document.getElementById('user-info');

    if (user) {
        if(authButtons) authButtons.style.display = 'none';
        if(userInfo) userInfo.style.display = 'flex';
        document.getElementById('user-email').textContent = user.email;
        
        // CORRECCIÓN: Llamamos a ambas funciones necesarias
        setTimeout(() => { 
            if(window.cargarDatosDesdeFirebase) window.cargarDatosDesdeFirebase(); 
            if(window.verificarNivelPremium) window.verificarNivelPremium(user.uid);
            if(window.actualizarAsesorLegalUI) window.actualizarAsesorLegalUI();
        }, 500);
    } else {
        if (typeof sincronizarEstadoPremium === 'function') sincronizarEstadoPremium(false);
        if(authButtons) authButtons.style.display = 'flex';
        if(userInfo) userInfo.style.display = 'none';
        if (typeof actualizarInterfazPremium === 'function') actualizarInterfazPremium(false);
        if(window.actualizarAsesorLegalUI) window.actualizarAsesorLegalUI();
    }
});
