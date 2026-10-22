# Native LVGL → PNG renderer for the desk screen UI. Builds firmware/ui/ unchanged on Linux.
#   tools/snapshot/run.sh            (configures, builds and renders every mock)
cmake_minimum_required(VERSION 3.16)
project(snapshot C)

set(CMAKE_C_STANDARD 11)
set(REPO ${CMAKE_CURRENT_SOURCE_DIR}/../..)
include(FetchContent)

# Pinned dependencies (same LVGL as the firmware)
FetchContent_Declare(lvgl  GIT_REPOSITORY https://github.com/lvgl/lvgl.git       GIT_TAG v9.3.0  GIT_SHALLOW TRUE)
FetchContent_Declare(cjson GIT_REPOSITORY https://github.com/DaveGamble/cJSON.git GIT_TAG v1.7.18 GIT_SHALLOW TRUE)
FetchContent_Declare(stb   GIT_REPOSITORY https://github.com/nothings/stb.git
                           GIT_TAG 2c980bb59875b0d32144a71867fbdebb2f77cd20)

set(LV_BUILD_CONF_DIR ${REPO}/firmware/include CACHE PATH "" FORCE)
set(CONFIG_LV_BUILD_DEMOS OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_USE_THORVG_INTERNAL OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(lvgl)
FetchContent_GetProperties(cjson)
if(NOT cjson_POPULATED)
  FetchContent_Populate(cjson)
endif()
FetchContent_GetProperties(stb)
if(NOT stb_POPULATED)
  FetchContent_Populate(stb)
endif()

file(GLOB UI_SOURCES ${REPO}/firmware/ui/*.c ${REPO}/firmware/ui/assets/*.c ${REPO}/firmware/ui/fonts/*.c)

add_executable(snapshot main.c ${UI_SOURCES} ${cjson_SOURCE_DIR}/cJSON.c)
target_include_directories(snapshot PRIVATE ${REPO}/firmware/ui ${REPO}/firmware/include ${cjson_SOURCE_DIR} ${stb_SOURCE_DIR})
target_compile_options(snapshot PRIVATE -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers)
target_link_libraries(snapshot PRIVATE lvgl m)
