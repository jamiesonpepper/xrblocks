class MetricsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this._bytesWritten = 0;
    this._buffer = new Float32Array(this.bufferSize);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const inputChannel = input[0];
      // Simple buffer accumulation
      // In a real generic processor, we'd handle ring buffers more carefully
      // But for 16khz single channel streaming, we can just push chunks.
      // Actually, AudioWorklet chunks are 128 frames. We need to batch them up 
      // or send them small. Sending 128 frames (8ms) is fine but high overhead for WS.
      // Let's buffer to ~2048 or 4096.

      for (let i = 0; i < inputChannel.length; i++) {
        this._buffer[this._bytesWritten++] = inputChannel[i];
        if (this._bytesWritten >= this.bufferSize) {
           this.flush();
        }
      }
    }
    return true;
  }

  flush() {
    // Send to main thread
    this.port.postMessage(this._buffer.slice(0, this._bytesWritten));
    this._bytesWritten = 0;
  }
}

registerProcessor('metrics-processor', MetricsProcessor);
