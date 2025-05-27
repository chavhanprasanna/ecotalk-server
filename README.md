# EchoSpace Socket.IO Server

This is the backend server for EchoSpace, a real-time voice and video chat application.

## Features

- Real-time communication with Socket.IO
- WebRTC signaling for peer-to-peer connections
- Supabase integration for authentication
- Room management for multi-user interactions

## Setup

1. Install dependencies:
```
npm install
```

2. Set environment variables:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PORT=3001 (optional)
```

3. Start the server:
```
npm start
```

## Deployment

This server can be deployed to platforms like Render, Railway, or Heroku.
