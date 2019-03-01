#!/bin/bash

# this shell script will be used to test your submissions. It
# works as follows:
# i) login to a lab machine and start your server (from the current
# directory using server.sh) in the background
# ii) run netem with some specific parameters
# iii) run your client on the local machine (using client.sh) and play back the sound file
# iv) run your client on the local machine and write the sound file to disk
# 
# You must have two shell scripts in your code directory:
# - server.sh which runs your server
# - client.sh which runs your server
# Example templates that you can edit are also provided
# 
# Your submission *MUST* work with this script. Do not edit this
# script. If you wish to change parameters you can use command-line
# options. e.g.

# default parameters
# host where server is running
SERVER_HOST=klovia.cs.st-andrews.ac.uk
# port of server
SERVER_PORT=23456
# the audio file that will be served
AUDIO_FILE="Beastie_Boys_-_Now_Get_Busy.wav"
# are we going to use netem? If not set, then no network parameters are changed
NETEM_TEST=0
# netem parameters for testing (make sure to enclose in "" when running)
NETEM_PARAMS="loss 0.1%"
# the netem interface (see the practical instructions for how to determine this)
NETEM_INTERFACE="enp4s0"
# get command-line parameters
while getopts "h:p:a:tn:i:" opt; do
    case $opt in
        h)
            SERVER_HOST="${OPTARG}"
            ;;
        p)
            SERVER_PORT="${OPTARG}"
            ;;
        a)
            AUDIO_FILE="${OPTARG}"
            ;;
        t)  
            NETEM_TEST=1
            ;;
        n)
            NETEM_PARAMS="${OPTARG}"
            ;;
        i)
            NETEM_INTERFACE="${OPTARG}"
            ;;
    esac
    shift $((OPTIND-1)); OPTIND=1
done

# the current directory; client.sh, server.sh and netem_wrapper.sh must be here
CURRENT_DIR=$(pwd)

# i) login and run server in the background
echo "running the server at ${SERVER_HOST} on port ${SERVER_PORT} and serving ${AUDIO_FILE}"
ssh -n -f ${SERVER_HOST} "sh -c 'cd ${CURRENT_DIR}; nohup ./server.sh ${SERVER_PORT} ${AUDIO_FILE} > /dev/null 2>&1 &'"

# ii) run netem on the server host
if [[ ${NETEM_TEST} -eq 1 ]]; then
    # current ip address
    LOCAL_IP=$(hostname -i)
    echo "setting up netem from ${LOCAL_IP} to ${SERVER_HOST} on interface ${NETEM_INTERFACE} with parameters ${NETEM_PARAMS}"
    ssh -n -f ${SERVER_HOST} "sh -c 'cd ${CURRENT_DIR}; nohup ./netem_wrapper.sh ${NETEM_INTERFACE} ${LOCAL_IP} ${NETEM_PARAMS} > /dev/null 2>&1 &'"
#ssh ${SERVER_HOST} ${CURRENT_DIR}/netem_wrapper.sh ${NETEM_INTERFACE} ${LOCAL_IP} ${NETEM_PARAMS}
fi

# iii) run client playing back
echo "running the client - if all goes well, something will play back now"
${CURRENT_DIR}/client.sh ${SERVER_HOST} ${SERVER_PORT}

# iv) run client writing to file
# generate a file name using the current time
FILE_NAME="${SERVER_HOST}_${SERVER_PORT}_"$(date +%s)".output"

echo "running the client again, this time writing to file ${FILE_NAME}"

${CURRENT_DIR}/client.sh ${SERVER_HOST} ${SERVER_PORT} ${FILE_NAME}

echo "cleaning up"
# clear netem settings
if [[ ${NETEM_TEST} -eq 1 ]]; then
    ssh ${SERVER_HOST} /usr/sbin/tc qdisc del dev ${NETEM_INTERFACE} root
fi

# kill the server
ssh ${SERVER_HOST} fuser -k -n udp ${SERVER_PORT}
