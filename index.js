import Game from './game.js'

window.onload = () => {
  var go_button = document.getElementById("start-rendering-button");

  var started = false;

  go_button.addEventListener("click", function(e){
    if( started ) {
      return;
    }
    started = true;
    
    // Install handlers and initialise the game
    var canvas = document.getElementById("webgl-canvas");
    if( !canvas ) {
      console.log("Failed to get game canvas :(");
      return;
    }

    var game = new Game(canvas);

    // canvas.addEventListener( "keydown", onKeyDown, true);
    // canvas.addEventListener( "keyup", onKeyUp, true);
    window.addEventListener( "keydown", game.onKeyDown, true);
    window.addEventListener( "keyup", game.onKeyUp, true);
    window.addEventListener( "resize", game.onWindowSize, true);

    game.onWindowSize();
  });
}
