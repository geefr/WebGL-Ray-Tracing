


// Intersection of ray with the sphere at primitives[i]
// - ray: A ray in world space (oh rayray, mommy misses you D:)
// - intersections array will be populated with t
// - Will return the number of intersections
// wiki/Line-sphere_intersection
int sphere_intersect(int i, Ray ray, out Intersection[2] intersections) {
  // pull ray into model space, rest of calculation is for sphere(o=0,0,0 r=1)
  Ray r = ray_tf_world_to_model(ray, primitives[i].modelMatrix);

  // Calculate Determinant - If negative it's a miss
  vec4 sphere_to_ray = r.origin - vec4(0.0, 0.0, 0.0, 1.0);
  float a = dot(r.direction, r.direction);
  float b = 2.0 * dot(r.direction, sphere_to_ray);
  float c = dot(sphere_to_ray, sphere_to_ray) - 1.0;
  float discriminant = (b * b) - (4.0 * a * c);
  if( discriminant < 0.0 ) {
    // Miss
    return 0;
  }

  // Hit
  float t1 = (-b - sqrt(discriminant)) / (2.0 * a);
  float t2 = (-b + sqrt(discriminant)) / (2.0 * a);

  int num_intersections = 0;
  intersections[0].i = i; intersections[1].i = i;
  if( abs(t1 - t2) < limit_epsilon ) { intersections[0].t = t1; intersections[1].t = t2; num_intersections = 1; }
  else if( t1 < t2 ) { intersections[0].t = t1; intersections[1].t = t2; num_intersections = 2; }
  else if( t2 < t1 ) { intersections[0].t = t2; intersections[1].t = t1; num_intersections = 2; }

  // Calculate uv
  // TODO: PERF: Duplicate calculation of p
  vec4 p0 = ray_to_position(r, t1);
  vec2 uv0;
  uv0.y = acos(p0.x / p0.y);
  uv0.x = acos(p0.y);
  intersections[0].uv = uv0;

  vec4 p1 = ray_to_position(r, t2);
  vec2 uv1;
  uv1.y = acos(p1.x / p1.y);
  uv1.x = acos(p1.y);
  intersections[1].uv = uv1;

  return num_intersections;
}

// Surface normal for sphere at point p (on surface of sphere, in world space)
vec4 sphere_normal(int i, vec4 p) {
  mat4 m = primitives[i].modelMatrix;
  vec4 pm = inverse(m) * p;
  vec4 n = pm - vec4(0.0, 0.0, 0.0, 1.0);
  // Technically should use sub(m,3,3), but zeroing w afterwards is easier
  n = transpose(inverse(m)) * n; 
  n.w = 0.0;
  return normalize(n);
}
