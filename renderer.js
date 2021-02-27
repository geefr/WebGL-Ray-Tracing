import Primitive from './primitives/primitive.js'
import Sphere from './primitives/sphere.js'

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.initialised = false;
  }

  async fetchFile(path) {
    return fetch(path, {headers: {'pragma': 'no-cache', 'cache-control': 'no-cache'}})
    .then((response)=>response.text())
    .then((data)=>{return data});
  }

  async init() {
    // Initialize the GL context
    const gl = this.canvas.getContext("webgl2");
    this.gl = gl;
    // Only continue if WebGL is available and working
    if (this.gl === null) {
      alert("Failed to initialise WebGL.");
      return;
    }

    // The Scene
    this.primitives = [
      new Sphere()
    ];

    // Shaders
    const fs_source = await this.fetchFile("shaders/raytrace_quad.frag");
    const vs_source = await this.fetchFile("shaders/raytrace_quad.vert");

    let vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vs_source);
    gl.compileShader(vs);
    if(!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error(`Vertex Shader: ${gl.getShaderInfoLog(vs)}`);
    }

    let fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fs_source);
    gl.compileShader(fs);
    if(!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error(`Fragment Shader: ${gl.getShaderInfoLog(fs)}`);
    }

    this.quad_program = gl.createProgram();
    gl.attachShader(this.quad_program, vs);
    gl.attachShader(this.quad_program, fs);
    gl.linkProgram(this.quad_program);
    if(!gl.getProgramParameter(this.quad_program, gl.LINK_STATUS)) {
      console.error(`Program Link ${gl.getProgramInfoLog(this.quad_program)}`);
    }
    gl.useProgram(this.quad_program);

    // Buffers
    this.quad_vao = gl.createVertexArray();
    gl.bindVertexArray(this.quad_vao);
    
    let positions = new Float32Array([
      -1.0, -1.0, 0.0,
       1.0, -1.0, 0.0,
       1.0,  1.0, 0.0,
       1.0,  1.0, 0.0,
      -1.0,  1.0, 0.0,
      -1.0, -1.0, 0.0
    ]);
    this.quad_vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad_vbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    let texCoords = new Float32Array([
      0.0, 0.0,
      1.0, 0.0,
      1.0, 1.0,
      1.0, 1.0,
      0.0, 1.0,
      0.0, 0.0
    ]);
    this.quad_vbo_texcoords = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad_vbo_texcoords);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);

    // Uniform locations & buffers
    this.primitives_ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.primitives_ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.pack_primitives_buffer, gl.STATIC_DRAW);

    this.quad_program_uni = {
      iResolution:gl.getUniformLocation(this.quad_program, "iResolution"),
      iNumPrimitives:gl.getUniformLocation(this.quad_program, "iNumPrimitives"),
      ubo_primitives:gl.getUniformBlockIndex(this.quad_program, "ubo_primitives")
    };

    this.initialised = true;
  }

  pack_primitives_buffer = () => {
    // Iterate over the primitives and pack their data into
    // buffers
    // Be very careful here vs the ubo format
    // struct Primitive {
    //   mat4 modelMatrix;
    //   vec4 meta;
    //   vec4 unused1;
    //   vec4 unused2;
    //   vec4 unused3;
    // };
    // // This block only contains the primitives, to simplify the buffer upload in js
    // layout (std140) uniform ubo_primitives
    // {
    //   Primitive primitives[100];
    // };
    
    // Buffer size must match primitive array in shader
    const num_floats = 1 * 32;
    let data = new Float32Array(num_floats);

    const num_prims = this.primitives.length;
    for(i = 0; i < num_prims; i++) {
      offset = i * 32;
      let p = this.primitives[i];
      // model matrix
      data[offset++] = p.modelMatrix[0];
      data[offset++] = p.modelMatrix[1];
      data[offset++] = p.modelMatrix[2];
      data[offset++] = p.modelMatrix[3];
      data[offset++] = p.modelMatrix[4];
      data[offset++] = p.modelMatrix[5];
      data[offset++] = p.modelMatrix[6];
      data[offset++] = p.modelMatrix[7];
      data[offset++] = p.modelMatrix[8];
      data[offset++] = p.modelMatrix[9];
      data[offset++] = p.modelMatrix[10];
      data[offset++] = p.modelMatrix[11];
      data[offset++] = p.modelMatrix[12];
      data[offset++] = p.modelMatrix[13];
      data[offset++] = p.modelMatrix[14];
      data[offset++] = p.modelMatrix[15];
      // meta
      data[offset++] = p.get_type();
      // Rest unused
    }
    return data;
  }

  render = () => {
    const gl = this.gl;
    if(gl === null ) {
      return;
    }
    if(!this.initialised) {
      return;
    }

    // console.log(`${this.canvas.width}x${this.canvas.height}`);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // Set clear color to black, fully opaque
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    // Clear the color buffer with specified clear color
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Draw the ray traced stuff
    gl.useProgram(this.quad_program);
    gl.bindVertexArray(this.quad_vao);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.primitives_ubo);
    gl.uniformBlockBinding(this.quad_program, this.quad_program_uni.primitives_ubo, 0);

    this.update_uniforms();
    
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  update_uniforms = () => {
    this.gl.uniform3f(this.quad_program_uni.iResolution, this.canvas.width, this.canvas.height, 0.0);
    this.gl.uniform1i(this.quad_program_uni.iNumPrimitives, this.primitives.length);
  }

}

export default Renderer;
