#!/bin/bash

# a template script for running your client
# you should edit these variables to work with your code.

# the commands that run your program, e.g.,
CLIENT="node ../Client/Client.js"
#SERVER="myclient.py"
# default host
HOST=klovia.cs.st-andrews.ac.uk
PORT=41236
# the file name that is written to
FILENAME="output.wav"

# DO NOT EDIT BELOW THIS LINE

# a host and port can be provided at the command-line as the first and
# second arguments
# a third optional argument is the file to write to
# note that there is no error-checking
if [[ $# -eq 2 ]]; then
    HOST=${1}
    PORT=${2}
elif [[ $# -eq 3 ]]; then
    HOST=${1}
    PORT=${2}
    FILENAME=${3}
fi

# start the client, with and without writing to a file
# your program should check that any parameters passed to it are valid
# and then start the client as appropriate
if [[ -z ${FILENAME} ]]; then
    ${CLIENT} ${HOST} ${PORT}
else
    ${CLIENT} ${HOST} ${PORT} ${FILENAME}
fi
