"use strict"
const fs = require('fs');
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

// Protocol messages
const START_TRANSFER = 'Start Transfer';
const PACKET_INFO_INDEX = 'Packet Info';
const PARTITION_PACKET = 'Partition Packet';
const INITIATE_TRANSFER = 'Initiate Partition Transfer';
const PARTITION_FINISHED = 'Partition Sent';
const FILE_TRANSFERED = 'Finished';
const MISSING_PACKET = 'Missing Packet'

// Server port
let port;

// File Information
let path = './AudioFiles/'
let filename;
let file;
let filebuffer = [];
let packetsPerPartition;
let numChunks;
var packetIndex = 0;

(function (){
    let args = process.argv;
    // If the number of args is less than 4 then throw error.
    if (args.length < 4)
    {
        console.log('Usage: node Server.js <Server Port> <Filename>')
        process.exit(0);
    }

    port = args[2];
    filename = args[3];

    file = fs.readFileSync(path + filename);
    socket.bind(port);   
})();


/**
 * Loads the file once the server is running.
 */
socket.on('listening', () => {
    let address = socket.address();
    console.log('Buffering audio file...');
    bufferFile();
    console.log(filename + " hosted on " + address.address + ':' + address.port);
});

/**
 * Error handling.
 */
socket.on('error', (err) => {
    console.log(err.stack);
    socket.close();
})

socket.on('message', (message, remote)=>{
    let packet = JSON.parse(message);
    let header = packet.header;
    let data = packet.body;
    switch(header)
    {
        case START_TRANSFER:
            // Send buffered File
            console.log('Streaming to ' + remote.address + ':' + remote.port);
            console.log('Sending Partitions...');
            // Sends the file details 
            let fileDetails = {
                "totalPackets" : numChunks,
                "partitionSize" : packetsPerPartition
            }
            packet = makePacket(PACKET_INFO_INDEX,fileDetails);

            console.log('Sending File Details')
            socket.send(JSON.stringify(packet), remote.port, remote.address)
            break;
        case INITIATE_TRANSFER:
            // Sends a specified partition of the file.
            if (data < filebuffer.length) 
                console.log('Initiate Transfer of partition ' + data)
            sendPacket(0, data, packetsPerPartition, remote);
            break;
        case MISSING_PACKET:
            // Sends the missed packets.
            let missedPacket = data.missing;
            let partition = data.partition;
            // console.log('Missed Packet ' + missedPacket + ' of Partition ' + partition);
            // Sends the packet information again if it hasn't been received.
            sendPacket(missedPacket, partition, 1 , remote);
            break;
        default:
            console.log('Error unknown command.')
    }
})

// TODO: Can probably change this to include the header as an argument.
/**
 * Sends a number of packets starting from the stored index.
 * @param {Integer} index 
 * @param {Integer} partitionIndex
 * @param {Integer} numPackets
 * @param {Object} remote 
 */
function sendPacket(index, partitionIndex, numPackets, remote)
{
    let partition = filebuffer[partitionIndex]
    let packet;

    switch(true)
    {
        case partitionIndex >= filebuffer.length:
            // Notifies the client that the file has been fully transferred
            packet = makePacket(FILE_TRANSFERED, null)
            socket.send(JSON.stringify(packet), remote.port, remote.address);
            console.log('File has been full transmitted.');
            return;
        case index < partition.length:
            // Sends packets starting from an index
            packet = makePacket(PARTITION_PACKET, partition[index]);
            
            socket.send(JSON.stringify(packet), remote.port, remote.address, (err)=>{
                if(err)throw err;
                sleep(0).then(()=>{
                    index++;
                    // Implements delay to prevent the output buffer from overlowing.
                    if(numPackets > 0) sendPacket(index, partitionIndex, --numPackets, remote);
                }); 
            });
            break;
        case index >= partition.length:
            // Sends the information of the next partition once the end of the current
            // partition is reached.
            console.log('Partition ' + partitionIndex + ' empty.');

            let nextSize = (partitionIndex == filebuffer.length - 1)? 0 : filebuffer[partitionIndex + 1].length;

            packet = makePacket(PARTITION_FINISHED,nextSize);
            socket.send(JSON.stringify(packet), remote.port, remote.address);
            break;
        default:
            // Notifies the client that the partition is empty by default.
            console.log('Reaches Default');
    }
}

/**
 * Stores the file in partitions which represent a percentage of a file. 
 * These partitions of packets are then stored in a buffer to be sent later.
 */
function bufferFile()
{
    let filesize = file.length;
    let chunkSize = 1024 * 15;
    numChunks = Math.ceil(filesize/chunkSize, chunkSize);
    let index = 0; // Chunk index

    // Divides the number of packets into percentages.
    const numPartitions = 100;
    packetsPerPartition = Math.ceil(numChunks/numPartitions);
    let partition = new Array();
    
    while(index < numChunks)
    {
        // Stores the packet into a partition.
        let offset = index * chunkSize;
        let buffer = file.slice(offset, chunkSize + offset);
        let packet = {
            'index' : index,
            'data' : buffer
        }
        partition.push(packet);
        index++;
        
        if(((index % packetsPerPartition) == 0 && index != 0) || index == numChunks-1)
        {
            // Adds the partition into the filebuffer when it is full or if it is the 
            // last partition of the file.
            filebuffer.push(partition);        
            partition = new Array();
        }
    }
}

/**
 * Creates and returns packet object.
 * @param {Object} header 
 * @param {Object} body 
 */
function makePacket(header, body)
{
    return {
        'header': header,
        'body': body
    }
}

/**
 * Puts the thread to sleep for a certain amount of time.
 * @param {Integer} ms 
 */
function sleep(ms) 
{
    return new Promise(resolve => setTimeout(resolve, ms));
}

