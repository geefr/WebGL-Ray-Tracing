
// Map type == 2.0 to plane_xz functions
#define PRIMITIVE_2_TYPE is_plane_xz
#define PRIMITIVE_2_INTERSECT plane_xz_intersect
#define PRIMITIVE_2_NORMAL plane_xz_normal

// Plane functions
bool is_plane_xz(int i) { return primitives[i].meta.x == 2.0; }

// Intersection of ray with the xz plane
// - ray: A ray in world space
bool plane_xz_intersect(int i, Ray ray, out Intersection intersection) {
  Ray r = ray_tf_world_to_model(ray, primitives[i].modelMatrix);

  // Rays parallel to the surface can't intersect
  // Coplanar rays intersect an infinite amount
  if( abs(r.direction.y) < limit_epsilon ) {
    return false;
  }

  float t = (- r.origin.y) / r.direction.y;
  intersection.i = i;
  intersection.t = t;

  // Calculate uv
  // TODO: PERF: Duplicate calculation of p
  // This is an infinite plane, so tile around 10x10
  vec4 p = ray_to_position(r, t);
  intersection.uv.x = p.x / 10.0;
  intersection.uv.y = p.z / 10.0;

  return true;
}

vec4 plane_xz_normal(int i) {
  mat4 m = primitives[i].modelMatrix;
  vec4 n = vec4(0.0, 1.0, 0.0, 0.0);
  n = transpose(inverse(m)) * n; 
  n.w = 0.0;
  return normalize(n);
}
