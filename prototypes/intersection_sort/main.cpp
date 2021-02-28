#include <iostream>
#include <cmath>

const unsigned int limit_in_per_ray_max = 10;
const float limit_inf = 1e20;
const float limit_float_max = 1e19;
const float epsilon = 1e-6;

struct vec4 {
    float x;
    float y;
    float z;
    float w;
};

struct Intersection {
  float t;     // Intersection distance (along current ray)
  int i;       // primitive index
  bool inside; // true if intersection is within an object (Ray going from inside -> outside)
  vec4 pos;    // Intersection position
  vec4 eye;    // Intersection -> eye vector
  vec4 normal; // Intersection normal
};

void init_intersection( Intersection& intersection ) { intersection.i = 0; intersection.t = limit_inf; }
void init_intersections( Intersection (&intersections)[limit_in_per_ray_max] ) { for( int i = 0; i < limit_in_per_ray_max; i++ ) {intersections[i].i = 0; intersections[i].t = limit_inf;}}

int closest_intersection( Intersection (&intersections)[limit_in_per_ray_max], int min_t, int max_t ) {
  int smallest_i = max_t + 1;
  float smallest_t = limit_inf;
  for( int i = min_t; i < max_t; i++ ) {
    if( intersections[i].t <= smallest_t ) {
      smallest_t = intersections[i].t;
      smallest_i = i;
    }
  }
  return smallest_i;
}

void sort_intersections( Intersection (&intersections)[limit_in_per_ray_max] ) {
  // A simple sort, nothing fancy
  Intersection result[limit_in_per_ray_max];

  for( int out_i = 0; out_i < limit_in_per_ray_max - 1; out_i++ ) {
    int smallest_i = closest_intersection(intersections, out_i, limit_in_per_ray_max);
    // Swap smallest with current element
    Intersection tmp = intersections[out_i];
    intersections[out_i] = intersections[smallest_i];
    intersections[smallest_i] = tmp;
  }
}

void print_intersections( Intersection (&intersections)[limit_in_per_ray_max] ) {
    std::cout << "\nIntersections:\n";
    for( int i = 0; i < limit_in_per_ray_max; i++ ) {
        std::cout << "intersections[" << i << "].t = " << intersections[i].t << "\n";
    }
}

int main(void) {
  Intersection intersections[limit_in_per_ray_max];
  init_intersections(intersections);
  intersections[0].t = 100.0;
  intersections[2].t = 50.0;
  intersections[5].t = 2.0;
  intersections[7].t = 1000.0;
  intersections[8].t = 8.0;

  print_intersections(intersections);

  sort_intersections(intersections);

  print_intersections(intersections);
}