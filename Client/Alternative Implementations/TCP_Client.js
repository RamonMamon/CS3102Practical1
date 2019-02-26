"use strict"
const dgram = require('dgram');
const client = dgram.createSocket('udp4');
const fs = require('fs');
const Stream = require('stream');
const fileStream = new Stream.Readable({
    read(size){
        // Empty body;
    }
});
const Speaker = require('speaker');

// Client's address information
const port = 41236;
// const host = 'localhost';

// Protocol messages
const START_TRANSFER = 'Start Transfer';
const PACKET_INFO_INDEX = 'Packet Info';
const PARTITION_PACKET = 'Partition Packet';
const INITIATE_TRANSFER = 'Initiate Partition Transfer';
const PARTITION_FINISHED = 'Partition Sent';
const FILE_TRANSFERED = 'Finished';

const REQUEST_INTERVAL = 1500;
const RETRY_ATTEMPTS = 4;
const NO_DATA = 0;

let serverPort;
let serverAddress;

let speaker = new Speaker();
let file;
let filename;

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
    if(message == 'Package delivered.')
    {
        // Saves the file once the full package has been received.
        console.log('Number of Packets received ' + processor.chunks.length)
        // Terminates the client
        close(client);
        
    }else
    {
        // Stores the packet in a buffer
        let packet = JSON.parse(message.toString())
        let data = Buffer.from(packet.data);
        if(processor.chunks[packet.index] == 0)
        {
            processor.chunks.splice(packet.index, 1, data);
            fileStream.push(chunk)
        }
        
        // Sends an ACK to the server.
        console.log('Received packet ' + packet.index);
        client.send(packet.index.toString(), remote.port, remote.address);
    }
});

client.on('listening', ()=>{
    console.log('Client is requesting on ' + client.address().address + ':' + port);
    console.log('Client is attempting to stream audio from ' + serverAddress + ':' + serverPort);

    // TCP
    client.send(START_TRANSFER, serverPort, serverAddress);
    processor.newPartition(37545)
})  

/**
 * Error handling.
 */
client.on('error', (err) => {
    console.log(err.stack);
    client.close();
})

/**
 * Closes the client when the song has finished.
 * @param {Object} client 
 */
function close(client)
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