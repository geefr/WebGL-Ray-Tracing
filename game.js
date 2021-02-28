import Renderer from "./renderer.js";

const space_bar = 32;
const right_arrow = 39;

class Game {

  constructor(canvas) {
    this.renderer = new Renderer(canvas);
    this.canvas = canvas;
    this.renderer.init();

    this.last_frame = Date.now();
    this.current_frame = this.last_frame;
    this.frame_delay_s = 1.0 / 30.0;

    requestAnimationFrame(this.frame);
  }

  frame = () => {
    // Frame timing
    this.current_frame = Date.now();
    let frame_delta = this.current_frame - this.last_frame;

    // TODO
    // Input handling
    // Logic update
    // Render
    this.renderer.render(frame_delta);

    this.last_frame = this.current_frame;

    requestAnimationFrame(this.frame);
  }

  onKeyDown = (ev) => {
    if(ev.keyCode === space_bar) {
    };
    if(ev.keyCode === right_arrow) {
    };
  }
  
  onKeyUp = (ev) => {
  }

  onWindowSize = () => {
    if( !this.canvas ) {
      return;
    }
    
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.canvas.style.width = w;
    this.canvas.style.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }
}

export default Game;
