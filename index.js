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
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:50527', 'https://ecotalk.netlify.app'];

console.log('Allowed origins for CORS:', allowedOrigins);

// Set up CORS for Express
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

// Create Socket.IO server with CORS configuration and better defaults
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  pingTimeout: 20000,
  pingInterval: 10000,
  cookie: false,
  transports: ['polling', 'websocket'], // Try polling first, then upgrade to websocket
  allowEIO3: true,
  connectTimeout: 45000,
  path: '/socket.io/' // Explicitly set the path
});

// Import UUID for generating unique IDs
const { v4: uuidv4 } = require('uuid');

// Store active rooms and participants with better structure
const rooms = new Map();

// Room structure:
// {
//   id: string,
//   name: string,
//   description: string,
//   category: string,
//   languages: string[],
//   maxParticipants: number,
//   isPrivate: boolean,
//   createdAt: string,
//   createdBy: string,
//   participants: Map<string, {
//     id: string,
//     name: string,
//     avatar: string,
//     socketId: string,
//     isMuted: boolean,
//     isVideoEnabled: boolean,
//     isHost: boolean,
//     joinedAt: string
//   }>,
//   messages: Array<{
//     id: string,
//     senderId: string,
//     senderName: string,
//     content: string,
//     timestamp: string
//   }>
// }

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create room
  socket.on('create-room', (roomData) => {
    try {
      console.log('Creating new room:', roomData.name);
      
      // Generate room ID if not provided
      const roomId = roomData.id || uuidv4();
      
      // Check if room already exists
      if (rooms.has(roomId)) {
        socket.emit('room-creation-error', { error: 'Room ID already exists' });
        return;
      }
      
      // Create new room with proper structure
      const newRoom = {
        id: roomId,
        name: roomData.name,
        description: roomData.description || '',
        category: roomData.category || 'General',
        languages: roomData.languages || ['English'],
        maxParticipants: roomData.maxParticipants || 10,
        isPrivate: roomData.isPrivate || false,
        createdAt: new Date().toISOString(),
        createdBy: socket.id,
        participants: new Map(),
        messages: [],
      };
      
      // Store room
      rooms.set(roomId, newRoom);
      
      // Notify creator
      socket.emit('room-created', { roomId, room: formatRoomForClient(newRoom) });
      
      // Broadcast to all users that a new room is available
      socket.broadcast.emit('room-added', formatRoomForClient(newRoom));
      
      console.log(`Room created: ${roomId}`);
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('room-creation-error', { error: 'Failed to create room' });
    }
  });

  // Join room
  socket.on('join-room', ({ roomId, user }) => {
    try {
      console.log(`User ${user.name} (${socket.id}) joining room ${roomId}`);
      
      // Check if room exists
      if (!rooms.has(roomId)) {
        // Create room if it doesn't exist (for development/testing purposes)
        console.log(`Room ${roomId} not found, creating it`);
        const newRoom = {
          id: roomId,
          name: `Room ${roomId.substring(0, 6)}`,
          description: 'Automatically created room',
          category: 'General',
          languages: ['English'],
          maxParticipants: 10,
          isPrivate: false,
          createdAt: new Date().toISOString(),
          createdBy: socket.id,
          participants: new Map(),
          messages: [],
        };
        
        rooms.set(roomId, newRoom);
      }
      
      const room = rooms.get(roomId);
      
      // Check if room is full
      if (room.participants.size >= room.maxParticipants) {
        socket.emit('room-error', { error: 'Room is full' });
        return;
      }
      
      // Join socket room
      socket.join(roomId);
      
      // Determine if user is host (first to join)
      const isHost = room.participants.size === 0;
      
      // Add user to room participants
      const participant = {
        id: user.id || socket.id,
        name: user.name,
        avatar: user.avatar || '',
        socketId: socket.id,
        isMuted: user.isMuted || true,
        isVideoEnabled: user.isVideoEnabled || false,
        isHost: isHost,
        joinedAt: new Date().toISOString()
      };
      
      room.participants.set(participant.id, participant);
      
      // Get current participants for the new user
      const participants = Array.from(room.participants.values());
      
      // Send room state to the new user
      socket.emit('room-state', {
        room: formatRoomForClient(room),
        participants,
        messages: room.messages,
      });
      
      // Log active connections for debugging
      console.log(`Room ${roomId} now has ${participants.length} participants:`, 
        participants.map(p => p.name).join(', '));
      
      // Broadcast to other participants that a new user joined
      socket.to(roomId).emit('user-joined', {
        userId: participant.id,
        user: participant,
        participants: participants.map(p => p.id)
      });
      
      console.log(`User ${participant.name} joined room ${roomId}, total participants: ${participants.length}`);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('room-error', { error: 'Failed to join room' });
    }
  });
  
  // Leave room
  socket.on('leave-room', ({ roomId, userId }) => {
    handleUserLeave(socket, roomId, userId || socket.id);
  });
  
  // Send message
  socket.on('send-message', ({ roomId, message }) => {
    try {
      if (!rooms.has(roomId)) return;
      
      const room = rooms.get(roomId);
      
      // Create message with proper structure
      const newMessage = {
        id: message.id || uuidv4(),
        senderId: message.senderId || socket.id,
        senderName: message.senderName || 'Anonymous',
        content: message.content,
        timestamp: message.timestamp || new Date().toISOString(),
      };
      
      console.log(`New message in room ${roomId}: ${newMessage.content.substring(0, 30)}...`);
      
      // Store message (limit to last 100 messages)
      room.messages.push(newMessage);
      if (room.messages.length > 100) {
        room.messages.shift();
      }
      
      // Broadcast to room (including sender for consistency)
      io.to(roomId).emit('new-message', newMessage);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });
  
  // Toggle audio
  socket.on('toggle-audio', ({ roomId, userId, isMuted }) => {
    try {
      if (!rooms.has(roomId)) return;
      
      const room = rooms.get(roomId);
      const participantId = userId || socket.id;
      
      if (room.participants.has(participantId)) {
        const participant = room.participants.get(participantId);
        participant.isMuted = isMuted;
        
        // Broadcast to room
        io.to(roomId).emit('user-audio-changed', { userId: participantId, isMuted });
      }
    } catch (error) {
      console.error('Error toggling audio:', error);
    }
  });
  
  // Toggle video
  socket.on('toggle-video', ({ roomId, userId, isVideoEnabled }) => {
    try {
      if (!rooms.has(roomId)) return;
      
      const room = rooms.get(roomId);
      const participantId = userId || socket.id;
      
      if (room.participants.has(participantId)) {
        const participant = room.participants.get(participantId);
        participant.isVideoEnabled = isVideoEnabled;
        
        // Broadcast to room
        io.to(roomId).emit('user-video-changed', { userId: participantId, isVideoEnabled });
      }
    } catch (error) {
      console.error('Error toggling video:', error);
    }
  });
  
  // WebRTC signaling with simple-peer
  socket.on('signal', ({ roomId, to, from, signal }) => {
    try {
      const signalType = signal.type || 'unknown';
      console.log(`Signal from ${from || socket.id} to ${to}, type: ${signalType}`);
      
      // Validate that both users are in the same room
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        const fromParticipant = Array.from(room.participants.values())
          .find(p => p.id === (from || socket.id) || p.socketId === (from || socket.id));
        const toParticipant = Array.from(room.participants.values())
          .find(p => p.id === to || p.socketId === to);
        
        if (fromParticipant && toParticipant) {
          // Valid participants, relay the signal
          socket.to(toParticipant.socketId).emit('signal', {
            from: fromParticipant.id,
            signal,
          });
          
          // Log signaling progress for debugging
          if (signalType === 'offer') {
            console.log(`WebRTC offer sent from ${fromParticipant.name} to ${toParticipant.name}`);
          } else if (signalType === 'answer') {
            console.log(`WebRTC answer sent from ${fromParticipant.name} to ${toParticipant.name}`);
          } else if (signalType === 'candidate') {
            console.log(`ICE candidate exchanged between ${fromParticipant.name} and ${toParticipant.name}`);
          }
        } else {
          console.warn(`Invalid signal: participant not found in room ${roomId}`);
        }
      } else {
        console.warn(`Invalid signal: room ${roomId} not found`);
      }
    } catch (error) {
      console.error('Error relaying signal:', error);
    }
  });
  
  // Get available rooms
  socket.on('get-rooms', () => {
    try {
      const availableRooms = Array.from(rooms.entries())
        .map(([id, room]) => formatRoomForClient(room))
        .filter(room => !room.isPrivate && room.participants.length < room.maxParticipants);
      
      socket.emit('rooms-list', availableRooms);
    } catch (error) {
      console.error('Error getting rooms:', error);
      socket.emit('rooms-list', []);
    }
  });
  
  // Disconnect handling
  socket.on('disconnect', () => {
    try {
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
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});
// Initialize Supabase client with service role key for server-side operations
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hhxlbwkhsogifgwlxuru.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

// Only initialize Supabase if the key is provided
if (supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase client initialized successfully with service role key');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
  }
} else {
  console.log('Supabase service role key not provided. Authentication features will be limited.');
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
// Format room data for client
function formatRoomForClient(room) {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    category: room.category,
    languages: room.languages,
    maxParticipants: room.maxParticipants,
    isPrivate: room.isPrivate,
    createdAt: room.createdAt,
    participants: Array.from(room.participants.values()).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isMuted: p.isMuted,
      isVideoEnabled: p.isVideoEnabled,
      isHost: p.isHost,
    })),
    participantCount: room.participants.size,
  };
}

// Clean up empty rooms
function cleanupEmptyRooms() {
  for (const [roomId, room] of rooms.entries()) {
    if (room.participants.size === 0) {
      console.log(`Cleaning up empty room: ${roomId}`);
      rooms.delete(roomId);
    }
  }
}

// Handle user leaving a room
function handleUserLeave(socket, roomId, userId) {
  try {
    console.log(`User ${userId} leaving room ${roomId}`);

    // Check if room exists
    if (!rooms.has(roomId)) {
      console.log(`Room ${roomId} not found for user leaving`);
      return;
    }
    
    // Log for debugging
    console.log(`Processing user leave: roomId=${roomId}, userId=${userId}, socketId=${socket?.id || 'unknown'}`);

    const room = rooms.get(roomId);

    // Check if user is in the room
    if (!room.participants.has(userId)) {
      console.log(`User ${userId} not found in room ${roomId}`);
      return;
    }

    // Get user info before removing
    const user = room.participants.get(userId);
    if (!user) {
      console.log(`User ${userId} not found in room ${roomId} participants map`);
      return;
    }
    
    console.log(`User ${user.name} (${userId}) leaving room ${roomId}`);

    // Remove user from room
    room.participants.delete(userId);

    // Leave socket room
    if (socket && socket.id === user.socketId) {
      socket.leave(roomId);
    }

    // Broadcast to room that user left
    io.to(roomId).emit('user-left', userId);
    
    console.log(`Notified room ${roomId} that user ${user.name} (${userId}) left`);

    // If room is empty, remove it after a short delay (in case of reconnects)
    if (room.participants.size === 0) {
      console.log(`Room ${roomId} is now empty, scheduling cleanup`);
      setTimeout(() => {
        if (rooms.has(roomId) && rooms.get(roomId).participants.size === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} removed (empty)`);
          // Broadcast room removed to all users
          io.emit('room-removed', { roomId });
        }
      }, 30000); // 30 second delay before removing empty room
    } else if (user.isHost) {
      // If host left, assign a new host
      const participants = Array.from(room.participants.values());
      if (participants.length > 0) {
        const newHost = participants[0];
        newHost.isHost = true;

        console.log(`New host assigned in room ${roomId}: ${newHost.name} (${newHost.id})`);

        // Broadcast new host
        io.to(roomId).emit('host-changed', {
          userId: newHost.id,
          name: newHost.name,
        });
      }
    }

    // Send updated participant list to remaining users
    const participants = Array.from(room.participants.values());
    io.to(roomId).emit('participants-updated', participants);

    return true;
  } catch (error) {
    console.error('Error handling user leave:', error);
    return false;
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