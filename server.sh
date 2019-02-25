#!/bin/bash

# a template script for running your server
# this script takes two parameters: a port number and file name of the audio file that is served
# you should edit this script 


# the commands that run your program, e.g.,
SERVER="node ./Server/Server.js"
#SERVER="myserver.py"
# default port
PORT=41235
# the audio file
AUDIOFILE="AudioFiles/sunflower.wav"

# DO NOT EDIT BELOW THIS LINE

# a port can be provided at the command-line as the sole argument
# note that there is no error-checking in this script
if [[ $# -eq 2 ]]; then
    PORT=${1}
    AUDIOFILE=${2}
fi

# run the server on the given port with the given audio file
# your program should check that any parameters passed to it are valid
# and then start the server as appropriate
${SERVER} ${PORT} ${AUDIOFILE}
