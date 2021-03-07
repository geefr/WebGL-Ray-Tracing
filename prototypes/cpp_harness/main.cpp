
#include <iostream>

#include <stdio.h>
#include <stdlib.h>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <map>
#include <vector>

#define GL_GLEXT_PROTOTYPES
#include <GL/gl.h>
#include <GL/glext.h>

#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

#include "primitives.h"

using namespace glm;

static void error_callback(int error, const char *description)
{
  fputs(description, stderr);
}

static void key_callback(GLFWwindow *window, int key, int scancode, int action, int mods)
{
  if (key == GLFW_KEY_ESCAPE && action == GLFW_PRESS)
    glfwSetWindowShouldClose(window, GL_TRUE);
}

std::string loadFile(const std::string &path)
{
  auto ss = std::ostringstream{};
  std::ifstream file(path);
  ss << file.rdbuf();
  return ss.str();
}

class Renderer
{
public:
  bool initialised = false;
  GLuint quad_program = 0;
  GLuint quad_vao = 0;
  GLuint quad_vbo = 0;
  GLuint quad_vbo_uv = 0;
  std::map<std::string, GLint> quad_program_uni;
  GLuint primitives_ubo = 0;
  glm::vec4 eyePos = {4.0, 6.0, 30.0, 1.0};

  std::vector<Material> materials;
  std::vector<PointLight> lights;
  std::vector<Primitive> primitives;

  uint32_t width, height;

  glm::mat4 viewMatrix;
  std::vector<float> viewParams;

  Renderer(uint32_t w, uint32_t h) 
  : width(w), height(h)
  {
    viewMatrix = glm::mat4(1.0f);
    init();
  }

  void init()
  {
    // The Scene
    create_primitives();

    // Shaders
    const auto fs_source = loadFile("../../shaders/raytrace_quad.frag");
    const auto vs_source = loadFile("../../shaders/raytrace_quad.vert");

    GLuint vs = glCreateShader(GL_VERTEX_SHADER);
    const char* vsc = vs_source.c_str();
    glShaderSource(vs, 1, &vsc, NULL);
    glCompileShader(vs);
    GLint result = GL_FALSE;
    glGetShaderiv(vs, GL_COMPILE_STATUS, &result);
    if( result != GL_TRUE ) throw std::runtime_error("Failed to compile vertex shader");


    GLuint fs = glCreateShader(GL_FRAGMENT_SHADER);
    const char* fsc = fs_source.c_str();
    glShaderSource(fs, 1, &fsc, NULL);
    glCompileShader(fs);
    result = GL_FALSE;
    glGetShaderiv(fs, GL_COMPILE_STATUS, &result);
    if( result != GL_TRUE ) throw std::runtime_error("Failed to compile fragment shader");

    quad_program = glCreateProgram();
    glAttachShader(quad_program, vs);
    glAttachShader(quad_program, fs);
    glLinkProgram(quad_program);
    glGetProgramiv(quad_program, GL_LINK_STATUS, &result);
    if( result != GL_TRUE ) {
      //Note: maxLength includes the NUL terminator.
      GLint maxLength = 0;
      glGetProgramiv(quad_program, GL_INFO_LOG_LENGTH, &maxLength);        

      //C++11 does not permit you to overwrite the NUL terminator,
      //even if you are overwriting it with the NUL terminator.
      //C++17 does, so you could subtract 1 from the length and skip the `pop_back`.
      std::basic_string<GLchar> infoLog(maxLength, '\0');
      glGetProgramInfoLog(quad_program, maxLength, &maxLength, &infoLog[0]);
      infoLog.pop_back();

      //Use the infoLog in whatever manner you deem best.
      throw std::runtime_error("Failed to link shader: " + infoLog);
    }
    glUseProgram(quad_program);

    glCreateVertexArrays(1, &quad_vao);
    glBindVertexArray(quad_vao);

    float positions[] = {
      -1.0, -1.0, 0.0,
      1.0, -1.0, 0.0,
      1.0, 1.0, 0.0,
      1.0, 1.0, 0.0,
      -1.0, 1.0, 0.0,
      -1.0, -1.0, 0.0
    };

    glCreateBuffers(1, &quad_vbo);
    glBindBuffer(GL_ARRAY_BUFFER, quad_vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 3, GL_FLOAT, false, 0, 0);
    glEnableVertexAttribArray(0);

    float texCoords[] = {
      0.0, 0.0,
      1.0, 0.0,
      1.0, 1.0,
      1.0, 1.0,
      0.0, 1.0,
      0.0, 0.0
    };
    glCreateBuffers(1, &quad_vbo_uv);
    glBindBuffer(GL_ARRAY_BUFFER, quad_vbo_uv);
    glBufferData(GL_ARRAY_BUFFER, sizeof(texCoords), texCoords, GL_STATIC_DRAW);
    glVertexAttribPointer(1, 2, GL_FLOAT, false, 0, 0);
    glEnableVertexAttribArray(1);

    // Uniform locations & buffers
    quad_program_uni = {
      {"viewParams", glGetUniformLocation(quad_program, "viewParams")},
      {"viewMatrix", glGetUniformLocation(quad_program, "viewMatrix")},
      {"iNumPrimitives", glGetUniformLocation(quad_program, "iNumPrimitives")},
      {"iNumMaterials", glGetUniformLocation(quad_program, "iNumMaterials")},
      {"iNumLights", glGetUniformLocation(quad_program, "iNumLights")},
      {"ubo_0", glGetUniformBlockIndex(quad_program, "ubo_0")}
    };

    upload_ubo_0(quad_program_uni["ubo_0"]);

    // Minor thing, but we don't need depth testing for full-screen ray tracing
    // glDisable(GL_DEPTH_TEST);

    initialised = true;
  }

  void create_primitives() {
    
    auto m = Material();
    glm::vec4 baseColour = {0.7,0.2,0.7,1.0};
    m.ambient *= baseColour;
    m.diffuse *= baseColour;
    materials.push_back(m);
    
    m = Material();
    baseColour = {0.2,0.7,0.2,1.0};
    m.ambient *= baseColour;
    m.diffuse *= baseColour;
    materials.push_back(m);
    
    m = Material();
    baseColour = {1.0, 1.0, 1.0, 1.0};
    m.ambient *= baseColour;
    m.diffuse *= baseColour;
    materials.push_back(m);
    
    m = Material();
    baseColour = {0.9, 0.9, 0.9, 1.0};
    m.ambient *= baseColour;
    m.diffuse *= baseColour;
    m.specular *= glm::vec4{0.2, 0.2, 0.2, 1.0};
    m.specular[3] = 1.0;
    materials.push_back(m);

    m = Material();
    baseColour = {0.9, 0.9, 0.9, 1.0};
    m.ambient *= baseColour;
    m.diffuse *= baseColour;
    m.specular *= glm::vec4{0.2, 0.2, 0.2, 1.0};
    m.specular[3] = 1.0;
    m.reflectivity() = 0.5;
    materials.push_back(m);

    m = Material();
    baseColour = {0.9, 0.9, 0.9, 1.0};
    m.ambient *= baseColour;
    m.diffuse *= baseColour;
    m.specular *= glm::vec4{0.2, 0.2, 0.2, 1.0};
    m.specular[3] = 1.0;
    m.reflectivity() = 1.0;
    materials.push_back(m);

    m = Material();
    baseColour = {1.0, 0.1, 0.1, 1.0};
    m.ambient *= baseColour;
    m.diffuse *= baseColour;
    m.specular[3] = 8.0;
    m.reflectivity() = 0.3;
    materials.push_back(m);

    m = Material();
    baseColour = {0.1, 0.1, 1.0, 1.0};
    m.ambient *= baseColour;
    m.diffuse *= baseColour;
    m.specular[3] = 16.0;
    m.transparency() = 0.7;
    materials.push_back(m); 

/////////////
    
    auto l = PointLight();
    l.position = { 0.0, 20.0, 20.0, 1.0 };
    l.intensity = {0.3, 0.3, 0.3, 1.0 };
    l.cast_shadows = true;
    lights.push_back(l);

    l = PointLight();
    l.position = {-30.0, 20.0, 30.0, 1.0 };
    l.cast_shadows = false;
    lights.push_back(l);
 
    l = PointLight();
    l.position = {20.0, 10.0, 0.0, 1.0 };
    l.cast_shadows = false;
    lights.push_back(l);

/////////////

    // bigboi
    Primitive p = Sphere();
    p.material() = 5;
    p.modelMatrix = glm::translate(p.modelMatrix, {-3, 2, 0});
    p.modelMatrix = glm::scale(p.modelMatrix, {2,2,2});
    primitives.push_back(p);

    // transparentboi
    p = Sphere();
    p.material() = 6;
    p.modelMatrix = glm::translate(p.modelMatrix, {0, 2, 5});
    p.modelMatrix = glm::scale(p.modelMatrix, {4,4,4});
    primitives.push_back(p);

    p = Sphere();
    p.material() = 7;
    p.modelMatrix = glm::translate(p.modelMatrix, {0, 2, -10});
    p.modelMatrix = glm::scale(p.modelMatrix, {16, 4, 16});
    primitives.push_back(p);

    // hugeboi
    p = Sphere();
    p.material() = 1;
    p.modelMatrix = glm::translate(p.modelMatrix, {0, -9, 0});
    p.modelMatrix = glm::scale(p.modelMatrix, {10,10,10});
    p.pattern_type() = 1;
    p.pattern = {64, 0, 0, 0};
    primitives.push_back(p);

    // smolboi
    p = Sphere();
    p.material() = 0;
    p.modelMatrix = glm::translate(p.modelMatrix, {1,2,0});
    p.modelMatrix = glm::scale(p.modelMatrix, {0.5,0.5,0.5});
    primitives.push_back(p);


    // The room, 50x50x50
    glm::vec4 xwall_pattern = { 1.0, 16.0, 0.0, 0.0 };
    glm::vec4 zwall_pattern = { 8.0, 8.0, 0.0, 0.0 };

    // floor and ceiling
    p = PlaneXZ();
    p.material() = 4;
    primitives.push_back(p);

    // x walls
    p = PlaneXZ();
    p.material() = 5;
    p.modelMatrix = glm::translate(p.modelMatrix, {60,0,0});
    p.modelMatrix = glm::rotate(p.modelMatrix, glm::radians(130.0f), glm::vec3{0.0f,0.0f,1.0f});
    primitives.push_back(p);

    p = PlaneXZ();
    p.material() = 5;
    p.modelMatrix = glm::translate(p.modelMatrix, {-60,0,0});
    p.modelMatrix = glm::rotate(p.modelMatrix, glm::radians(-130.0f), glm::vec3{0.0f,0.0f,1.0f});
    primitives.push_back(p);

    // z walls
    p = PlaneXZ();
    p.material() = 5;
    p.modelMatrix = glm::translate(p.modelMatrix, {0.0, 0.0, 60.0});
    p.modelMatrix = glm::rotate(p.modelMatrix, glm::radians(-130.0f), glm::vec3{1.0f, 0.0f, 0.0f});
    primitives.push_back(p);

    p = PlaneXZ();
    p.material() = 5;
    p.modelMatrix = glm::translate(p.modelMatrix, {0.0, 0.0, -60.0});
    p.modelMatrix = glm::rotate(p.modelMatrix, glm::radians(130.0f), glm::vec3{1.0f, 0.0f, 0.0f});
    primitives.push_back(p);

    // A translucent plane, splitting the middle of smolboi and bigboi
    // p = PlaneXZ();
    // p.material() = 6;
    // p.modelMatrix = glm::rotate(p.modelMatrix, glm::radians(90.0f), glm::vec3{1.0f, 0.0f, 0.0f});
    // primitives.push_back(p);
  }

  void upload_ubo_0(GLint ubo_index) {
    // Get the buffer size + offsets
    GLint ubo_size = 0;
    glGetActiveUniformBlockiv(quad_program, ubo_index, GL_UNIFORM_BLOCK_DATA_SIZE, &ubo_size);
    float data[ubo_size / sizeof(float)];

    // Size and offsets in floats
    // The structure padding is excessive/paranoid here, but allows for future expansion
    const uint32_t light_size = 16;
    const uint32_t material_size = 16;
    const uint32_t primitive_size = 32;

    // MAKE SURE THESE MATCH THE SHADER!
    const uint32_t max_lights = 4;
    const uint32_t max_materials = 8;
    const uint32_t max_primitives = 20;

    const uint32_t lights_offset = 0;
    const uint32_t materials_offset = max_lights * light_size;
    const uint32_t primitives_offset = materials_offset + (max_materials * material_size);

    auto num_lights = lights.size();
    if (num_lights > max_lights)
    {
      throw std::runtime_error("Too many lights");
      num_lights = max_lights;
    }
    auto num_materials = materials.size();
    if (num_lights > max_lights)
    {
      throw std::runtime_error("Too many materials");
      num_lights = max_lights;
    }
    auto num_primitives = primitives.size();
    if (num_lights > max_lights)
    {
      throw std::runtime_error("Too many primitives");
      num_lights = max_lights;
    }

    for (auto i = 0; i < num_lights; i++)
    {
      auto offset = lights_offset + (i * light_size);
      auto& l = lights[i];
      data[offset++] = l.intensity[0];
      data[offset++] = l.intensity[1];
      data[offset++] = l.intensity[2];
      data[offset++] = l.intensity[3];

      data[offset++] = l.position[0];
      data[offset++] = l.position[1];
      data[offset++] = l.position[2];
      data[offset++] = l.position[3];

      if (l.cast_shadows)
      {
        data[offset++] = 1.0;
      }
      else
      {
        data[offset++] = 0.0;
      }
    }

    for (auto i = 0; i < num_materials; i++)
    {
      auto offset = materials_offset + (i * material_size);
      auto& m = materials[i];

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

      data[offset++] = m.phys[0];
      data[offset++] = m.phys[1];
      data[offset++] = m.phys[2];
      data[offset++] = m.phys[3];
    }

    for (auto i = 0; i < num_primitives; i++)
    {
      auto offset = primitives_offset + (i * primitive_size);
      auto& p = primitives[i];

      data[offset++] = p.modelMatrix[0][0];
      data[offset++] = p.modelMatrix[0][1];
      data[offset++] = p.modelMatrix[0][2];
      data[offset++] = p.modelMatrix[0][3];
      data[offset++] = p.modelMatrix[1][0];
      data[offset++] = p.modelMatrix[1][1];
      data[offset++] = p.modelMatrix[1][2];
      data[offset++] = p.modelMatrix[1][3];
      data[offset++] = p.modelMatrix[2][0];
      data[offset++] = p.modelMatrix[2][1];
      data[offset++] = p.modelMatrix[2][2];
      data[offset++] = p.modelMatrix[2][3];
      data[offset++] = p.modelMatrix[3][0];
      data[offset++] = p.modelMatrix[3][1];
      data[offset++] = p.modelMatrix[3][2];
      data[offset++] = p.modelMatrix[3][3];

      data[offset++] = p.meta[0];
      data[offset++] = p.meta[1];
      data[offset++] = p.meta[2];
      data[offset++] = p.meta[3];

      data[offset++] = p.pattern[0];
      data[offset++] = p.pattern[1];
      data[offset++] = p.pattern[2];
      data[offset++] = p.pattern[3];
    }

    glCreateBuffers(1, &primitives_ubo);
    glBindBuffer(GL_UNIFORM_BUFFER, primitives_ubo);
    glBindBufferBase(GL_UNIFORM_BUFFER, 0, primitives_ubo);
    glBufferData(GL_UNIFORM_BUFFER, sizeof(data), data, GL_DYNAMIC_DRAW);

    // std::exit(1);
  }

  void render() {
    if (!initialised)
    {
      return;
    }

    // Perspective parameters
    // TODO: This is calculated within the shader, there is no projection matrix
    float fov = 60.0;
    float nearZ = 1.0;
    float farZ = 100.0;
    
    viewParams = {(float)width, (float)height, glm::radians(fov), nearZ};

    float eyeRot = 0.005;
    glm::mat4 rotMat(1.0f);
    rotMat = glm::rotate(rotMat, eyeRot, {0.f,1.f,0.f});

    eyePos = rotMat * eyePos;

    viewMatrix = glm::lookAt(glm::vec3{eyePos.x,eyePos.y,eyePos.z}, glm::vec3{0.0, 0.0, 0.0}, glm::vec3{0.0, 1.0, 0.0});

    glViewport(0, 0, width, height);
    // Set clear color to black, fully opaque
    glClearColor(0.0, 0.0, 0.0, 1.0);
    // Clear the color buffer with specified clear color
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    // Draw the ray traced stuff
    glUseProgram(quad_program);
    glBindVertexArray(quad_vao);

    glUniformBlockBinding(quad_program, quad_program_uni["primitives_ubo"], 0);
    glBindBufferBase(GL_UNIFORM_BUFFER, 0, primitives_ubo);

    update_uniforms();
    glDrawArrays(GL_TRIANGLES, 0, 6);
  }

  void update_uniforms()
  {
    glUniform4f(quad_program_uni["viewParams"],
      viewParams[0],
      viewParams[1],
      viewParams[2],
      viewParams[3]
    );

    glUniform1i(quad_program_uni["iNumPrimitives"], primitives.size());
    glUniform1i(quad_program_uni["iNumMaterials"], materials.size());
    glUniform1i(quad_program_uni["iNumLights"], lights.size());

    glUniformMatrix4fv(quad_program_uni["viewMatrix"], 1, GL_FALSE, glm::value_ptr(viewMatrix));
  }
};

void APIENTRY glDebugOutput(GLenum source, 
                            GLenum type, 
                            unsigned int id, 
                            GLenum severity, 
                            GLsizei length, 
                            const char *message, 
                            const void *userParam)
{
    // ignore non-significant error/warning codes
    if(id == 131169 || id == 131185 || id == 131218 || id == 131204) return; 

    std::cout << "---------------" << std::endl;
    std::cout << "Debug message (" << id << "): " <<  message << std::endl;

    switch (source)
    {
        case GL_DEBUG_SOURCE_API:             std::cout << "Source: API"; break;
        case GL_DEBUG_SOURCE_WINDOW_SYSTEM:   std::cout << "Source: Window System"; break;
        case GL_DEBUG_SOURCE_SHADER_COMPILER: std::cout << "Source: Shader Compiler"; break;
        case GL_DEBUG_SOURCE_THIRD_PARTY:     std::cout << "Source: Third Party"; break;
        case GL_DEBUG_SOURCE_APPLICATION:     std::cout << "Source: Application"; break;
        case GL_DEBUG_SOURCE_OTHER:           std::cout << "Source: Other"; break;
    } std::cout << std::endl;

    switch (type)
    {
        case GL_DEBUG_TYPE_ERROR:               std::cout << "Type: Error"; break;
        case GL_DEBUG_TYPE_DEPRECATED_BEHAVIOR: std::cout << "Type: Deprecated Behaviour"; break;
        case GL_DEBUG_TYPE_UNDEFINED_BEHAVIOR:  std::cout << "Type: Undefined Behaviour"; break; 
        case GL_DEBUG_TYPE_PORTABILITY:         std::cout << "Type: Portability"; break;
        case GL_DEBUG_TYPE_PERFORMANCE:         std::cout << "Type: Performance"; break;
        case GL_DEBUG_TYPE_MARKER:              std::cout << "Type: Marker"; break;
        case GL_DEBUG_TYPE_PUSH_GROUP:          std::cout << "Type: Push Group"; break;
        case GL_DEBUG_TYPE_POP_GROUP:           std::cout << "Type: Pop Group"; break;
        case GL_DEBUG_TYPE_OTHER:               std::cout << "Type: Other"; break;
    } std::cout << std::endl;
    
    switch (severity)
    {
        case GL_DEBUG_SEVERITY_HIGH:         std::cout << "Severity: high"; break;
        case GL_DEBUG_SEVERITY_MEDIUM:       std::cout << "Severity: medium"; break;
        case GL_DEBUG_SEVERITY_LOW:          std::cout << "Severity: low"; break;
        case GL_DEBUG_SEVERITY_NOTIFICATION: std::cout << "Severity: notification"; break;
    } std::cout << std::endl;
    std::cout << std::endl;
}

int main(void)
{
  GLFWwindow *window;

  glfwSetErrorCallback(error_callback);
  

  if (!glfwInit())
    exit(EXIT_FAILURE);

  glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 6);
  glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
  // glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
  glfwWindowHint(GLFW_RESIZABLE, GL_FALSE);
  glfwWindowHint(GLFW_OPENGL_DEBUG_CONTEXT, true);  

  auto w = 800;
  auto h = 800;
  window = glfwCreateWindow(w, h, "Web Tracing CeePlusPlus", NULL, NULL);
  if (!window)
  {
    glfwTerminate();
    exit(EXIT_FAILURE);
  }

  glfwMakeContextCurrent(window);

  int flags; glGetIntegerv(GL_CONTEXT_FLAGS, &flags);
  if (flags & GL_CONTEXT_FLAG_DEBUG_BIT)
  {
      glEnable(GL_DEBUG_OUTPUT);
      glEnable(GL_DEBUG_OUTPUT_SYNCHRONOUS); 
      glDebugMessageCallback(glDebugOutput, nullptr);
      glDebugMessageControl(GL_DONT_CARE, GL_DONT_CARE, GL_DONT_CARE, 0, nullptr, GL_TRUE);
  } 


  glfwSetKeyCallback(window, key_callback);
  // glfwSwapInterval(1);

  Renderer renderer(w, h);

  while (!glfwWindowShouldClose(window))
  {
    renderer.render();

    glfwSwapBuffers(window);

    glfwPollEvents();
    //glfwWaitEvents();
  }

  glfwDestroyWindow(window);

  glfwTerminate();
  exit(EXIT_SUCCESS);
}
