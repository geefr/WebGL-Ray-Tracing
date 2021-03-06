#ifndef PRIMITIVES_H
#define PRIMITIVES_H

#include <glm/glm.hpp>
#include <glm/matrix.hpp>

class Primitive {
  public:
    Primitive() {
      modelMatrix = glm::mat4(1.0f);
    }
    float& type_number() { return meta[0]; }
    float& material() { return meta[1]; }
    float& pattern_type() { return meta[2]; }

    std::string type;
    glm::mat4 modelMatrix;
    glm::vec4 meta;
    glm::vec4 pattern;
};

class Sphere : public Primitive {
  public:
    Sphere() {type = "sphere";}
};

class PlaneXZ : public Primitive {
  public:
    PlaneXZ() {type = "plane_xz";}
};

class Material {
  public:
    float& shininess() {return specular[3];}
    float& reflectivity() {return phys[0];}
    float& transparency() {return phys[1];}
    float& refractivi() {return phys[2];}

    glm::vec4 ambient = {0.1, 0.1, 0.1, 1.0};
    glm::vec4 diffuse = {0.9, 0.9, 0.9, 1.0};
    glm::vec4 specular = {1.0, 1.0, 1.0, 32.0};
    glm::vec4 phys = {0.0, 0.0, 1.0, 0.0};
};

class PointLight {
  public:
  glm::vec4 intensity = {1.0, 1.0, 1.0, 1.0};
  glm::vec4 position = {0.0, 0.0, 0.0, 1.0};
  bool cast_shadows = false;
};

#endif