# XRHome Demo

A WebXR Proof of Concept that combines **XRBlocks**, **Google Gemini Multimodal API**, and **Google Home Device Access API**.

This demo allows you to:
1.  **Scan** your environment using the device camera (WebRTC).
2.  **Identify** lamps and lights using Gemini Vision.
3.  **Control** real smart lights (via Google Home) by interacting with virtual overlays in AR.
    -   **Pinch**: Toggle Light On/Off.
    -   **Rotate Wrist**: Adjust Brightness (Experimental).

## Prerequisites

You will need:
1.  **Google Gemini API Key**: Get one from [Google AI Studio](https://aistudio.google.com/).
2.  **Google Cloud Project**:
    -   Enable **Smart Device Management API**.
    -   Create an **OAuth 2.0 Client ID** (Web Application).
    -   Set `redirect_uri` to your hosting URL (e.g., `https://localhost:8080/demos/xrhome/index.html`).
3.  **Device Access Project ID**: From the [Device Access Console](https://console.nest.google.com/device-access/).

## Setup & Running

### Option 1: Docker (Recommended for SSL)

WebRTC requires a Secure Context (HTTPS or localhost). To run with HTTPS enabled:

1.  **Generate Self-Signed Certificates** (Run at repository root):
    ```bash
    openssl req -newkey rsa:2048 -new -nodes -x509 -days 3650 -keyout key.pem -out cert.pem
    ```

2.  **Build the Docker Image**:
    ```bash
    docker build -t xrhome-demo .
    ```

3.  **Run the Container**:
    ```bash
    docker run --name xrhome -it --rm -p 8080:8080 xrhome-demo
    ```

4.  **Open in Browser**:
    Navigate to [https://localhost:8080/demos/xrhome/index.html](https://localhost:8080/demos/xrhome/index.html).
    *Note: You will need to accept the security warning for the self-signed certificate.*

### Option 2: Local Node.js

1.  Install `http-server`:
    ```bash
    npm install -g http-server
    ```

2.  Run from root:
    ```bash
    # Simple localhost (WebRTC works on localhost without SSL)
    http-server . -p 8080
    
    # OR with SSL (requires certs generated above)
    http-server . -S -C cert.pem -K key.pem -p 8080
    ```

## Usage

1.  Enter your **Gemini API Key**, **Project ID**, and **Client ID** in the configuration overlay.
2.  Click **Start Demo**.
3.  Grant Camera permissions.
4.  Point your camera at a light source (Lamp/Overhead).
5.  Wait for the scan (every 30s) to detect the light and place a yellow/white marker.
6.  **Pinch** the marker with your virtual hand to toggle the light.
