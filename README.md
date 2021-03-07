# WebGL2 Ray Tracing - 'realtime' ray tracing in a browser

This is a fairly basic (and currently proof of concept) ray tracer written in an opengl fragment shader.

Shader is hosted by a renderer written in javascript (or C++ in the prototypes dir).

A live version should be available [on my website](https://gfrancisdev.co.uk/dev/web-tracing)

Before viewing the page I recommend:
* That you have a decent graphics card - Anything above a NVidia GTX 950 should suffice
* That you use chrome, or other fast browser (You need WebGL2 support as a minimum, firefox works but is slower)
* That you save your work, and close any videos/games you've got open already

## Current status / next steps
I've got this to a point where it could be useful, but mainly it's a side-effect of me learning the concepts. Watch this space if you like but I don't expect rapid development on this.

General TODO list:
* The code is a bit of a mess, general tidy needed
* Need to implement refraction (changing direction of ray in current 'transparency' calculation)
* Need to rework the shader interface, currently around 12 floats are wasted per primitive, and there's no checks on the shader uniform limits before compiling shaders
* Need to move the scene definition out into a file format, json or similar
* Need to move the primitive functions out - Should be possible to inject a new primitive type as a glsl function, without a shader rewrite
* Docs, docs, and more docs (If anyone else wants to read the code that is)

## Primitives
Currently only spheres and planes are supported, but the interfaces should be extensible enough for new functions.

## Shader Interface
The shader setup is fairly messy and inefficient at the moment, but boils down to
* Some #defines to enable components of the ray tracing algorithm
* A set of limits defined in the shader - Maximum number of reflections/similar
* A set of hard limits on the number of primitives, materials, and lights
* A UBO containing the primitives, materials, lights, and set of uniforms to setup the shader

## Performance / Hardware supported
So far testing has been limited, mostly performed on Linux, NVidia Quadro M2000, running the proprietary drivers.
A rough benchmark here is 25-30fps for an 800x800 pixel window. Performance is slightly lower in the browser, so the browser version is set to render at a lower resolution.

Some testing was performed on an Intel 530, but the performance is not acceptable at the moment (Will need heavy resolution scaling / a small canvas)

# Thanks / Credits
Various sources were used to implement this, but a large credit goes to the book "The Ray Tracer Challenge" by Jamis Buck. I didn't follow it that closely in the end but it's well written, and covers the concepts in a clear manner.
