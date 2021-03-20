
// Plane functions
// Intersection of ray with the xz plane
// - ray: A ray in world space
int plane_xz_intersect(int i, Ray ray, out Intersection[2] intersections) {
  Ray r = ray_tf_world_to_model(ray, primitives[i].modelMatrix);

  // Rays parallel to the surface can't intersect
  // Coplanar rays intersect an infinite amount
  if( abs(r.direction.y) < limit_epsilon ) {
    return 0;
  }

  float t = (- r.origin.y) / r.direction.y;
  intersections[0].i = i;
  intersections[0].t = t;

  // Calculate uv
  // TODO: PERF: Duplicate calculation of p
  // This is an infinite plane, so tile around 10x10
  vec4 p = ray_to_position(r, t);
  intersections[0].uv.x = p.x / 10.0;
  intersections[0].uv.y = p.z / 10.0;

  return 1;
}

vec4 plane_xz_normal(int i, vec4 p) {
  mat4 m = primitives[i].modelMatrix;
  vec4 n = vec4(0.0, 1.0, 0.0, 0.0);
  n = transpose(inverse(m)) * n; 
  n.w = 0.0;
  return normalize(n);
}
