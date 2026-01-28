# Sâm Lốc Card Game

## Overview
A multiplayer Vietnamese card game (Sâm Lốc) built with Node.js, Express, and Socket.io for real-time gameplay.

## Project Structure
- `index.js` - Main server file with Express and Socket.io setup
- `room.js` - Room management logic
- `rules.js` - Card game rules implementation
- `scoring.js` - Scoring logic
- `config.js` - Game configuration constants
- `public/` - Frontend static files
  - `index.html` - Main HTML page
  - `client.js` - Client-side JavaScript
  - `style.css` - Styles

## Tech Stack
- Node.js with Express for HTTP server
- Socket.io for real-time WebSocket communication
- Static HTML/CSS/JS frontend

## Running the Application
```bash
npm start
```
The server runs on port 5000.

## Deployment
Configured for VM deployment to support persistent WebSocket connections.
