#!/usr/bin/env sh
set -e
g++ --std=c++17  main.cpp -lglfw -lGLEW -lGL
./a.out

