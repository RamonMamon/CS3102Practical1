#!/bin/bash

# simple script to delete all tc settings and then adjust network
# conditions to and from a given host. An example invocation is:
#
# netem_wrapper.sh enp4s0 138.251.29.55 "delay 100ms"
#
# note that there is no error-checking so be careful
#
# tnhh, Jan 2019

# command-line parameters
INTERFACE="$1"
DESTINATION="$2"
NETEM=${@:3} # all remaining parameters are passed to netem

# delete all current settings (don't worry if this reports an error as
# it just means that there are no current netem settings)
/usr/sbin/tc qdisc del dev ${INTERFACE} root 

# create a new tc class
/usr/sbin/tc qdisc add dev ${INTERFACE} root handle 1: prio

# change some netem parameters
echo "adding netem parameters ${NETEM} to ${DESTINATION} on ${INTERFACE}"
/usr/sbin/tc qdisc add dev ${INTERFACE} parent 1:3 handle 30: netem ${NETEM}

# ensure that these parameters are only set up for a single host.
# Otherwise they will affect all traffic, including to the servers
# where your home directory is located, and cause the lab machines to
# lock up!
/usr/sbin/tc filter add dev ${INTERFACE} protocol ip parent 1:0 prio 3 u32 \
    match ip dst ${DESTINATION} flowid 1:3
