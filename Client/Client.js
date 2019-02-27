"use strict"
const dgram = require('dgram');
const client = dgram.createSocket('udp4');
// const Processor = require('./Processor');
const fs = require('fs');
const Stream = require('stream');
const fileStream = new Stream.Readable({
    read(size){
        // Empty body;
    }
});
const Speaker = require('speaker');
const speaker = new Speaker();

// Client's address information
const port = 41236;

// Protocol messages
const START_TRANSFER = 'Start Transfer';
const PACKET_INFO_INDEX = 'Packet Info';
const PARTITION_PACKET = 'Partition Packet';
const INITIATE_TRANSFER = 'Initiate Partition Transfer';
const PARTITION_FINISHED = 'Partition Sent';
const FILE_TRANSFERRED = 'Finished';
const MISSING_PACKET = 'Missing Packet'

const REQUEST_INTERVAL = 1000;
const RETRY_ATTEMPTS = 10;
const NO_DATA = 0;

let serverPort;
let serverAddress;

let oldPartitionOffset = 0;
let partitionOffset = 0;

let defaultPartitionSize;
let requestInterval;
let packetTimeout;

let file;
let filename;
let chunks;
let flushing = false;
let fileFinished = false;
let timeoutLocked = false;

let startTime, endTime, totalTime;

(() => {
    let args = process.argv;
    // If the number of args is less than 4 then throw error.
    if (args.length < 4)
    {
        console.log('Usage: node Client.js <Server Address> <Server Port> [Optional: FileName.wav]')
        process.exit(0);
    }

    serverAddress = args[2];
    serverPort = args[3];
    filename = (args.length < 5)? 'output.wav': args[4];
    file = fs.createWriteStream(filename);
    fileStream.pipe(file);
    fileStream.pipe(speaker);
    client.bind(port);    

})();


client.on('message', (message, remote)=>{
    let packet = JSON.parse(message)
    let header = packet.header; 
    let body = packet.body;
    
    switch(true)
    {
        case header == PACKET_INFO_INDEX:
            // Saves the file details.
            clearInterval(requestInterval);
            // totalPackets = body.totalPackets;
            // newPartition(body.partitionSize);
            defaultPartitionSize = body.partitionSize;
            chunks = new Array(body.partitionSize).fill(NO_DATA);
            
            // Requests for the first partition.
            console.log('File details received. File transfer initiated.');
            console.log('Partition Size is ' + body.partitionSize);
                
            sendPacket(INITIATE_TRANSFER, 0, remote, true);
            // packetTimeout = getTimeout();
            totalTime = new Date();
            startTime = new Date();
            break;

        case header == PARTITION_PACKET:
            // Starts storing the data into a buffer once the file details are received.
            // clearInterval(requestInterval);
            
            let index = body.index;
            let data = Buffer.from(body.data);
            
            // The index of the packet in the partition
            let offset = defaultPartitionSize * partitionOffset;
            let partitionIndex = index - offset;

            // Stores the data if it does not already exist.
            if(chunks[partitionIndex] == NO_DATA)
            {
                // clearInterval(packetTimeout);
                // console.log('Received packet ' + (partitionIndex ) + ' from Partition ' + partitionOffset)
                chunks[partitionIndex] = data;
                // packetTimeout = getTimeout();
            }
            break;

        case header == PARTITION_FINISHED:
            // Processes the current partition and creates a new partition of the received Size.
            clearInterval(requestInterval)
            // clearInterval(packetTimeout);
            flushPartition(serverAddress, serverPort, body, ()=>{
                console.log('Requesting for Partition '  + partitionOffset); 
                sendPacket (INITIATE_TRANSFER, partitionOffset, remote, true);
                // flushing = false;
                // packetTimeout = getTimeout();
            });
            break;

        case header == FILE_TRANSFERRED:
            // Once the file is fully received, the client is triggered to close.
            
            console.log('Transferred file in ' +  (endTime-totalTime)/1000 + ' seconds');
            clearInterval(requestInterval)
            clearInterval(packetTimeout);
            fileFinished = true;
            console.log('File fully received.');
            close();
            break;

        default:
            console.log('Unknown Command.');
    }
});


function getTimeout(){
    
    let interval = setInterval(() => {
        console.log('Setting Timeout');
        if(!timeoutLocked && !fileFinished)
        {
            console.log('Locking Timeout');
            timeoutLocked = true;

            if(partitionOffset == oldPartitionOffset)
            {
                // Checks if the 
                console.log('Missed timeout at ' + partitionOffset);
                flushPartition(serverAddress, serverPort, defaultPartitionSize, ()=>{
                    console.log('Requesting for Partition '  + partitionOffset); 
                    let remote = {
                        'address': serverAddress,
                        'port': serverPort
                    };
                    sendPacket (INITIATE_TRANSFER, partitionOffset, remote, true);
                    
                    console.log('Recovered from timeout');
                });
            }else
            {
                oldPartitionOffset = partitionOffset;
            }
            console.log('Unlocking Timeout');
            timeoutLocked = false;
            
        }
        else{
            clearInterval(interval)
            console.log('Timeout Locked');
        } 
    },100);
    return interval;
}

/**
 * Fixes any errors in the file and flushes it out to the output buffer.
 * @param {String} serverAddress
 * @param {Integer} serverPort
 * @param {Integer} nextPartitionSize
 */
function flushPartition(serverAddress, serverPort, nextPartitionSize, callback)
{
    if(flushing == false){
        flushing = true;
        requestMissingPackets(serverAddress, serverPort)
        .then(()=>{
            // Waits for the missing packets to be retreived before flushing the buffered packets.

            endTime = new Date();
            let processTime = (endTime - startTime)/1000;
            // totalTime += processTime;
            startTime = new Date()
            console.log('Processed partition ' + partitionOffset + ' in ' + processTime + ' seconds');
            
            partitionOffset++;
            // Writes the processed partition to the the readable stream buffer
            chunks.forEach((element) =>{
                fileStream.push(element)
            });

            // Creates a new partition of a specified size.
            chunks = new Array(nextPartitionSize).fill(NO_DATA);
            flushing = false;
            callback();
        }).catch(()=>{
            console.log('Promise unresolved');
        });
    }
}

/**
 * Requests for any missing packets until the specified index. 
 * @param {String} serverAddress
 * @param {Integer} serverPort
 * @param {function} callback
 */
function requestMissingPackets(serverAddress, serverPort) 
{
    return new Promise((resolve, reject)=>{
        // Looks for the indeces that have no data in them (which is set to 0).
        let missing = chunks.indexOf(NO_DATA);
        let interval = setInterval(()=>{
            // Prevents the function from overflowing the buffer with requests.  
            if(missing == -1)
            {
                clearInterval(interval)
                // console.log('No missing');
                return resolve();
            }
            
            // Requests the missing packets of the current offset from the server.
            let data = {
                "missing": missing,
                "partition": partitionOffset
            }
            let packet = makePacket(MISSING_PACKET, data);

            client.send(JSON.stringify(packet), serverPort, serverAddress);
            missing = chunks.indexOf(NO_DATA);
        }, 0)        
    });
}

client.on('listening', ()=>{
    console.log('Client is requesting on ' + client.address().address + ':' + port);
    console.log('Client is attempting to stream audio from ' + serverAddress + ':' + serverPort);
    let remote = {
        'address':serverAddress,
        'port':serverPort
    }

    sendPacket(START_TRANSFER, null, remote, true);
})  


/**
 * Error handling.
 */
client.on('error', (err) => {
    console.log(err.stack);
    client.close();
})

/**
 * Sends a message to the specified server following a specific protocol.
 * @param {String} header Is the Protocol message that the message follows
 * @param {Object} body Is the data in to be sent to the server
 * @param {Object} remote The server details.
 * @param {Bool} essential Is true if the packet is needs guaranteed retreival.
 */
function sendPacket(header, body, remote, essential)
{
    let packet = makePacket(header,body);
    client.send(JSON.stringify(packet), remote.port, remote.address)
    if(essential)
    {
        // Checks if essential packets have been acknowledged by the server.
        requestInterval = setInterval(()=>{
            // Attempts to reconnect to the server after 1500ms
            // console.log('Next partition not received after 1500ms.');
            console.log('Timeout on Partition ' + body);
            console.log('Attempting to reconnect...');
            client.send(JSON.stringify(packet), remote.port, remote.address);
        }, 100);
    }
}

/**
 * Closes the client when the song has finished.
 * @param {Object} client 
 */
function close()
{
    fileStream.push(null);
    console.log('Waiting for audio to finish.')
    speaker.on('finish', () => {
        file.end();
        client.close();
        console.log('File Outputted as ' + filename);
        console.log('Closing client.');
    });
}

function makePacket(header, body)
{
    return {
        'header': header,
        'body' : body
    }
}