#!/usr/bin/env sh
set -e
g++ --std=c++17 -Werror main.cpp -lglfw -lGLEW -lGL
./a.out

