import Primitive from './primitives/primitive.js'
import Sphere from './primitives/sphere.js'
import PointLight from './primitives/pointlight.js'
import Material from './primitives/material.js'
import * as glMatrix from './modules/gl-matrix-2.8.1/lib/gl-matrix.js'

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
    const gl = this.canvas.getContext("webgl2", {
      antialias: true, // This may be a dumb idea for ray tracing :)
      powerPreference: "high-performance"
    });
    this.gl = gl;
    // Only continue if WebGL is available and working
    if (this.gl === null) {
      alert("Failed to initialise WebGL.");
      return;
    }

    // The Scene
    this.create_primitives();

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
    this.quad_program_uni = {
      iResolution:gl.getUniformLocation(this.quad_program, "iResolution"),
      iNumPrimitives:gl.getUniformLocation(this.quad_program, "iNumPrimitives"),
      iNumMaterials:gl.getUniformLocation(this.quad_program, "iNumMaterials"),
      iNumLights:gl.getUniformLocation(this.quad_program, "iNumLights"),
      ubo_primitives:gl.getUniformBlockIndex(this.quad_program, "ubo_0")
    };

    this.primitives_ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.primitives_ubo);
    this.upload_ubo_0(this.quad_program_uni.ubo_primitives)

    // Minor thing, but we don't need depth testing for full-screen ray tracing
    gl.disable(gl.DEPTH_TEST);

    this.initialised = true;
  }

  create_primitives = () => {
    this.materials = [];
    let m = new Material();
    let baseColour = [0.7, 0.2, 0.7, 1.0];
    glMatrix.vec4.multiply(m.ambient, m.ambient, baseColour);
    glMatrix.vec4.multiply(m.diffuse, m.diffuse, baseColour);
    this.materials.push(m);

    m = new Material();
    baseColour = [0.2, 0.7, 0.2, 1.0];
    glMatrix.vec4.multiply(m.ambient, m.ambient, baseColour);
    glMatrix.vec4.multiply(m.diffuse, m.diffuse, baseColour);
    this.materials.push(m);

    this.lights = [];
    let l = new PointLight();
    l.position = [-10.0, 5.0, 0.0, 1.0];
    l.intensity = [1.0, 0.5, 0.5, 1.0];
    this.lights.push(l);

    l = new PointLight();
    l.position = [10.0, 5.0, 0.0, 1.0];
    l.intensity = [0.5, 1.0, 0.5, 1.0];
    this.lights.push(l);

    l = new PointLight();
    l.position = [0.0, -5.0, 0.0, 1.0];
    l.intensity = [0.5, 0.5, 1.0, 1.0];
    this.lights.push(l);

    this.primitives = [];
    let p = new Sphere();
    p.set_material(0);
    glMatrix.mat4.translate(p.modelMatrix, p.modelMatrix, [-0.75, 0.0, 8.0]);
    glMatrix.mat4.scale(p.modelMatrix, p.modelMatrix, [0.5, 0.5 , 0.5]);
    this.primitives.push(p);

    p = new Sphere();
    p.set_material(1);
    glMatrix.mat4.translate(p.modelMatrix, p.modelMatrix, [0.75, 0.0, 8.0]);
    glMatrix.mat4.scale(p.modelMatrix, p.modelMatrix, [0.5, 0.5 , 0.5]);
    this.primitives.push(p);
  }

  upload_ubo_0 = (blockIndex) => {
    // Iterate over the primitives and pack their data into
    // the UBO. Method must be called with UBO currently bound
    // to UNIFORM_BUFFER, and shader program bound.
    // TODO: This is ugly as all heck
    //
    // struct Primitive {
    //   mat4 modelMatrix;
    //   vec4 meta;
    //   vec4 pad1;
    //   vec4 pad2;
    //   vec4 pad3;
    // };
    
    // struct Light {
    //   vec4 intensity;  // rgb_
    //   vec4 position;   // xyz1 (TODO: Support for directional lights)
    //   vec4 pad1;
    //   vec4 pad2;
    // };
    
    // struct Material {
    //   vec4 ambient;    // rgb_
    //   vec4 diffuse;    // rgb_
    //   vec4 specular;   // rgbs, s=shininess
    //   vec4 pad1;
    // };
    //
    // layout (std140) uniform ubo_0
    // {
    //   Light lights[10];
    //   Material materials[10];
    //   Primitive primitives[40];
    // };
    
    // Get the buffer size + offsets
    let ubo_size = this.gl.getActiveUniformBlockParameter(
      this.quad_program, blockIndex, this.gl.UNIFORM_BLOCK_DATA_SIZE)
    let data = new Float32Array(ubo_size / 4);

    // Size and offsets in floats
    // The structure padding is excessive/paranoid here, but allows for future expansion
    const light_size = 16;
    const material_size = 16;
    const primitive_size = 32;

    const lights_offset = 0;
    const materials_offset = 10 * light_size;
    const primitives_offset = materials_offset + (10 * material_size);

    for(let i = 0; i < this.lights.length; i++) {
      let offset = lights_offset + (i * light_size);
      let l = this.lights[i];
      data[offset++] = l.intensity[0];
      data[offset++] = l.intensity[1];
      data[offset++] = l.intensity[2];
      data[offset++] = l.intensity[3];

      data[offset++] = l.position[0];
      data[offset++] = l.position[1];
      data[offset++] = l.position[2];
      data[offset++] = l.position[3];
    }

    for(let i = 0; i < this.materials.length; i++) {
      let offset = materials_offset + (i * material_size);
      let m = this.materials[i];

      data[offset++] = m.ambient[0];
      data[offset++] = m.ambient[1];
      data[offset++] = m.ambient[2];
      data[offset++] = m.ambient[3];

      data[offset++] = m.diffuse[0];
      data[offset++] = m.diffuse[1];
      data[offset++] = m.diffuse[2];
      data[offset++] = m.diffuse[3];

      data[offset++] = m.specular[0];
      data[offset++] = m.specular[1];
      data[offset++] = m.specular[2];
      data[offset++] = m.specular[3];
    }

    const num_prims = this.primitives.length;
    for(let i = 0; i < num_prims; i++) {
      let offset = primitives_offset + (i * primitive_size);
      let p = this.primitives[i];
      
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
      
      data[offset++] = p.meta[0];
      data[offset++] = p.meta[1];
      data[offset++] = p.meta[2];
      data[offset++] = p.meta[3];
    }
    
    this.gl.bufferData(this.gl.UNIFORM_BUFFER, data, this.gl.DYNAMIC_DRAW);
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

    gl.uniformBlockBinding(this.quad_program, this.quad_program_uni.primitives_ubo, 0);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.primitives_ubo);

    this.update_uniforms();
    
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  update_uniforms = () => {
    this.gl.uniform3f(this.quad_program_uni.iResolution, this.canvas.width, this.canvas.height, 0.0);
    this.gl.uniform1i(this.quad_program_uni.iNumPrimitives, this.primitives.length);
    this.gl.uniform1i(this.quad_program_uni.iNumMaterials, this.materials.length);
    this.gl.uniform1i(this.quad_program_uni.iNumLights, this.lights.length);
  }

}

export default Renderer;
