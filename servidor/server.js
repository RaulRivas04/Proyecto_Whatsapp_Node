const express = require('express');
const path = require('path');
const port = process.env.PORT || 3000;
const { Server } = require('socket.io');
const { createServer } = require('node:http');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, getDocs, query, orderBy, where, deleteDoc, doc } = require('firebase/firestore');

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBOhsw3bxRTq59miBrNIb_ip4U0OnXhXmA",
  authDomain: "tarea-whatsapp.firebaseapp.com",
  projectId: "tarea-whatsapp",
  storageBucket: "tarea-whatsapp.firebasestorage.app",
  messagingSenderId: "382729683647",
  appId: "1:382729683647:web:ab423c0ebabddb4c2cbc0a",
  measurementId: "G-SF3XYR23WW"
};

// Inicializar Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const app = express();
const server = createServer(app);
const io = new Server(server);
let usuarios = [];

// Ruta para servir la página inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
  console.log('me piden una pagina inicial');
});

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, '/public')));

// Ruta para obtener mensajes privados
app.get('/privateMessages', async (req, res) => {
  const { from, to } = req.query;
  const q = query(collection(db, `privateMessages_${from}_${to}`), orderBy('timestamp'));
  const querySnapshot = await getDocs(q);
  const messages = querySnapshot.docs.map(doc => doc.data());
  res.json(messages);
});

// Manejar conexiones de socket
io.on('connection', async (socket) => {
  console.log('Nuevo Usuario Conectado');

  // Recuperar y enviar mensajes anteriores
  const q = query(collection(db, 'mensajes'), orderBy('timestamp'));
  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    socket.emit('mensaje', doc.data());
  });

  // Recuperar y enviar salas existentes
  const roomsQuery = query(collection(db, 'rooms'), orderBy('timestamp'));
  const roomsSnapshot = await getDocs(roomsQuery);
  const rooms = roomsSnapshot.docs.map(doc => doc.data().name);
  socket.emit('existingRooms', rooms);

  // Manejar evento de inicio de sesión
  socket.on('login', (datos) => {
    socket.nombre = datos.nombre;
    socket.estado = datos.estado;
    socket.avatar = datos.avatar;
    usuarios.push({ nombre: datos.nombre, estado: datos.estado, avatar: datos.avatar });
    io.emit('userList', usuarios);
    io.emit('userConnected', datos.nombre); // Emitir solo el nombre del usuario
  });

  // Manejar evento de unirse a una sala
  socket.on('joinRoom', async (room) => {
    socket.join(room);
    socket.room = room;
    const timestamp = new Date();
    const hora = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    io.to(room).emit('mensaje', { nombre: 'Sistema', mensaje: `${socket.nombre} se ha unido a la sala ${room}`, avatar: 'avatars/avatar.png', hora });

    // Recuperar y enviar mensajes anteriores de la sala
    const q = query(collection(db, `mensajes_${room}`), orderBy('timestamp'));
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
        socket.emit('mensaje', doc.data());
    });
  });

  // Manejar evento de creación de una sala
  socket.on('createRoom', async (roomName) => {
    const roomsQuery = query(collection(db, 'rooms'), where('name', '==', roomName));
    const roomsSnapshot = await getDocs(roomsQuery);

    if (!roomsSnapshot.empty) {
        socket.emit('roomCreationFailed', 'El nombre de la sala ya existe');
        return;
    }

    io.emit('roomCreated', roomName);

    // Guardar la sala en Firestore
    await addDoc(collection(db, 'rooms'), {
        name: roomName,
        timestamp: new Date()
    });
  });

  // Manejar evento de recepción de un mensaje
  socket.on('mensaje', async (datos) => {
    const timestamp = new Date();
    const hora = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const mensajeConHora = { ...datos, hora };

    console.log('Soy el servidor y recibo mensaje con datos: ' + datos.nombre + "," + datos.mensaje);
    io.to(socket.room).emit('mensaje', mensajeConHora);

    // Guardar mensaje en Firestore en la colección de la sala
    await addDoc(collection(db, `mensajes_${socket.room}`), {
      ...mensajeConHora,
      timestamp
    });
  });

  // Manejar evento de recepción de un archivo
  socket.on('file', async (datos) => {
    const { nombre, fileName, fileData, avatar } = datos;
    const timestamp = new Date();
    const hora = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fileConHora = { ...datos, hora };

    io.to(socket.room).emit('file', { nombre, fileName, fileData, avatar, hora });

    // Guardar mensaje de archivo en Firestore en la colección de la sala
    await addDoc(collection(db, `mensajes_${socket.room}`), {
        nombre,
        fileName,
        fileData,
        avatar,
        hora,
        timestamp
    });
  });

  // Manejar evento de usuario escribiendo
  socket.on('typing', (nombre) => {
    socket.to(socket.room).emit('typing', nombre);
  });

  // Manejar evento de mensaje privado
  socket.on('privateMessage', async (datos) => {
    const { to, message } = datos;
    const recipientSocket = [...io.sockets.sockets.values()].find(s => s.nombre === to);
    const timestamp = new Date();
    const hora = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (recipientSocket) {
      recipientSocket.emit('privateMessage', { from: socket.nombre, message, avatar: socket.avatar, hora });

      // Guardar mensaje privado en Firestore
      await addDoc(collection(db, `privateMessages_${socket.nombre}_${to}`), {
        from: socket.nombre,
        to,
        message,
        avatar: socket.avatar,
        hora,
        timestamp
      });
      await addDoc(collection(db, `privateMessages_${to}_${socket.nombre}`), {
        from: socket.nombre,
        to,
        message,
        avatar: socket.avatar,
        hora,
        timestamp
      });
    }
  });

  // Manejar evento de archivo privado
  socket.on('privateFile', async (datos) => {
    const { to, fileName, fileData, avatar } = datos;
    const recipientSocket = [...io.sockets.sockets.values()].find(s => s.nombre === to);
    const timestamp = new Date();
    const hora = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (recipientSocket) {
        recipientSocket.emit('privateFile', { from: socket.nombre, fileName, fileData, avatar, hora });

        // Guardar mensaje de archivo privado en Firestore
        await addDoc(collection(db, `privateMessages_${socket.nombre}_${to}`), {
            from: socket.nombre,
            to,
            fileName,
            fileData,
            avatar,
            hora,
            timestamp
        });
        await addDoc(collection(db, `privateMessages_${to}_${socket.nombre}`), {
            from: socket.nombre,
            to,
            fileName,
            fileData,
            avatar,
            hora,
            timestamp
        });
    }
  });

  // Manejar evento de salir de una sala
  socket.on('leaveRoom', async (room) => {
    socket.leave(room);
    const timestamp = new Date();
    const hora = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    io.to(room).emit('mensaje', { nombre: 'Sistema', mensaje: `${socket.nombre} ha abandonado la sala ${room}`, avatar: 'avatars/avatar.png', hora });
    socket.room = null;
    socket.emit('roomLeft', room);
  });

  // Manejar evento de eliminar una sala
  socket.on('deleteRoom', async (room) => {
    // Eliminar la sala de Firestore
    const roomsQuery = query(collection(db, 'rooms'), where('name', '==', room));
    const roomsSnapshot = await getDocs(roomsQuery);

    if (!roomsSnapshot.empty) {
        const roomDoc = roomsSnapshot.docs[0];
        await deleteDoc(doc(db, 'rooms', roomDoc.id));
        io.emit('roomDeleted', room);
    }

    // Eliminar los mensajes de la sala de Firestore
    const messagesQuery = query(collection(db, `mensajes_${room}`));
    const messagesSnapshot = await getDocs(messagesQuery);

    messagesSnapshot.forEach(async (doc) => {
        await deleteDoc(doc.ref);
    });
  });

  // Manejar evento de desconexión de un usuario
  socket.on('disconnect', () => {
    console.log('Usuario desconectado');
    usuarios = usuarios.filter(user => user.nombre !== socket.nombre);
    io.emit('userList', usuarios);
    io.emit('userDisconnected', socket.nombre);
  });
});

// Iniciar el servidor
server.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});