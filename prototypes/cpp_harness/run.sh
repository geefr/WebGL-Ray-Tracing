#!/usr/bin/env sh
set -e
g++ main.cpp -g -O0 -lglfw -lGLEW -lGL
./a.out

