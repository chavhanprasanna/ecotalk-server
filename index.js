const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Get allowed origins from environment variable or use defaults
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'https://ecotalk.netlify.app'];

console.log('Allowed origins for CORS:', allowedOrigins);

// Create Socket.IO server with CORS configuration
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Store active rooms and participants
const rooms = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Join room
  socket.on('join-room', ({ roomId, user }) => {
    console.log(`User ${user.name} joined room ${roomId}`);
    
    // Join socket room
    socket.join(roomId);
    
    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        participants: new Map(),
        messages: [],
      });
      
      // Make first user the host
      user.isHost = true;
    }
    
    // Add user to room participants
    const room = rooms.get(roomId);
    room.participants.set(user.id, {
      ...user,
      socketId: socket.id,
    });
    
    // Broadcast to other participants
    socket.to(roomId).emit('user-joined', user);
    
    // Send current participants to the new user
    const participants = Array.from(room.participants.values());
    socket.emit('room-state', {
      participants,
      messages: room.messages,
    });
  });
  
  // Leave room
  socket.on('leave-room', ({ roomId, userId }) => {
    handleUserLeave(socket, roomId, userId);
  });
  
  // Send message
  socket.on('send-message', ({ roomId, message }) => {
    console.log(`New message in room ${roomId}: ${message.content}`);
    
    const room = rooms.get(roomId);
    if (room) {
      // Store message
      room.messages.push(message);
      
      // Broadcast to room (except sender)
      socket.to(roomId).emit('new-message', message);
    }
  });
  
  // Toggle audio
  socket.on('toggle-audio', ({ roomId, userId, isMuted }) => {
    const room = rooms.get(roomId);
    if (room && room.participants.has(userId)) {
      const participant = room.participants.get(userId);
      participant.isMuted = isMuted;
      
      // Broadcast to room
      io.to(roomId).emit('user-audio-changed', { userId, isMuted });
    }
  });
  
  // Toggle video
  socket.on('toggle-video', ({ roomId, userId, isVideoEnabled }) => {
    const room = rooms.get(roomId);
    if (room && room.participants.has(userId)) {
      const participant = room.participants.get(userId);
      participant.isVideoEnabled = isVideoEnabled;
      
      // Broadcast to room
      io.to(roomId).emit('user-video-changed', { userId, isVideoEnabled });
    }
  });
  
  // WebRTC signaling events
  socket.on('offer', ({ roomId, to, from, offer }) => {
    socket.to(to).emit('offer', { from, offer });
  });
  
  socket.on('answer', ({ roomId, to, from, answer }) => {
    socket.to(to).emit('answer', { from, answer });
  });
  
  socket.on('ice-candidate', ({ roomId, to, from, candidate }) => {
    socket.to(to).emit('ice-candidate', { from, candidate });
  });
  
  // Disconnect handling
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    // Find rooms that the user was in
    for (const [roomId, room] of rooms.entries()) {
      for (const [userId, participant] of room.participants.entries()) {
        if (participant.socketId === socket.id) {
          handleUserLeave(socket, roomId, userId);
          break;
        }
      }
    }
  });
});
// Initialize Supabase client with service role key for server-side operations
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hhxlbwkhsogifgwlxuru.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

try {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Supabase client initialized successfully with service role key');
} catch (error) {
  console.error('Failed to initialize Supabase client:', error);
}

// Enhanced authentication middleware with Supabase support
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  const anonymousId = socket.handshake.auth.anonymousId || generateRandomId();
  
  // Check if user provided a token for authentication
  if (token && supabase) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data && data.user) {
        // Authenticated user
        socket.userId = data.user.id;
        socket.user = data.user;
        socket.isAuthenticated = true;
        console.log(`Authenticated user connected: ${socket.userId}`);
      } else {
        // Invalid token, fallback to anonymous
        socket.userId = anonymousId;
        socket.isAuthenticated = false;
        console.log(`Anonymous user connected with ID: ${socket.userId} (token error: ${error?.message || 'invalid token'})`);
      }
    } catch (error) {
      // Error in authentication, fallback to anonymous
      socket.userId = anonymousId;
      socket.isAuthenticated = false;
      console.error('Auth error:', error);
      console.log(`Anonymous user connected with ID: ${socket.userId} (auth error)`);
    }
  } else {
    // No token provided, anonymous user
    socket.userId = anonymousId;
    socket.isAuthenticated = false;
    console.log(`Anonymous user connected with ID: ${socket.userId}`);
  }
  
  next();
});

// Helper function to generate random IDs for anonymous users
function generateRandomId() {
  return Math.random().toString(36).substring(2, 15);
}
// Handle user leaving a room
function handleUserLeave(socket, roomId, userId) {
  console.log(`User ${userId} left room ${roomId}`);
  
  const room = rooms.get(roomId);
  if (!room) return;
  
  // Remove user from participants
  room.participants.delete(userId);
  
  // Broadcast to room
  socket.to(roomId).emit('user-left', userId);
  
  // If room is empty, remove it
  if (room.participants.size === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} removed (empty)`);
  } else {
    // If the leaving user was the host, assign a new host
    const wasHost = Array.from(room.participants.values()).every(p => !p.isHost);
    if (wasHost && room.participants.size > 0) {
      // Assign first remaining user as host
      const newHostId = room.participants.keys().next().value;
      const newHost = room.participants.get(newHostId);
      newHost.isHost = true;
      
      // Broadcast new host
      io.to(roomId).emit('new-host', newHostId);
    }
  }
  
  // Leave socket room
  socket.leave(roomId);
}

// API endpoints for rooms
app.get('/api/rooms', (req, res) => {
  const roomsList = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    participants: room.participants.size,
    // Add other room metadata as needed
  }));
  
  res.json(roomsList);
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});