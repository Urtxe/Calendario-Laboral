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
                // Llamamos a la función que muestra la elección de Mensual/Anual
                if (typeof mostrarPreciosPremium === "function") {
                    mostrarPreciosPremium();
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
                if (typeof mostrarPreciosPremium === "function") {
                    mostrarPreciosPremium();
                }
            }, 1000);
        }
    }).catch((error) => {
        console.error("Error en Google Auth:", error);
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
        }, 500);
    } else {
        if(authButtons) authButtons.style.display = 'flex';
        if(userInfo) userInfo.style.display = 'none';
    }
});
