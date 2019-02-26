"use strict"
const fs = require('fs');
const Stream = require('stream');
const fileStream = new Stream.Readable({
    read(size){
        // Empty body;
    }
});
const Speaker = require('speaker');
const speaker = new Speaker();
const NO_DATA = 0;

let file;

/**
 * Exports the Processor class which contains the clients functionality to 
 * parse, request, and write out data, to be used by the main client.
 */
module.exports = class Processor 
{
    constructor(client, filename)
    {
        this.client = client;
        this.partitionOffset = 0;
        this.partitionCount = 0;
        this.chunks;
        this.filename = filename;
        
        file = fs.createWriteStream(filename);
        fileStream.pipe(file);
        fileStream.pipe(speaker);
    }

    /**
     * Creates a new Partition filled with 0s.
     * @param {Integer} size 
     */
    newPartition(size)
    {
        this.chunks = new Array(size).fill(NO_DATA);
    }

    /**
     * Fixes any errors in the file and flushes it out to the output buffer.
     * @param {String} serverAddress
     * @param {Integer} serverPort
     * @param {Integer} nextPartitionSize
     */
    flushPartition(serverAddress, serverPort, nextPartitionSize, callback)
    {
        this.requestMissingPackets(serverAddress, serverPort, ()=>{
            // Waits for the missing packets to be retreived before flushing the buffered packets.
            this.incrementPartitionOffset();
            // Writes the processed partition to the the readable stream buffer
            this.chunks.forEach((element) =>{
                fileStream.push(element)
            });

            // Creates a new partition of a specified size.
            this.newPartition(nextPartitionSize);

            callback();
        });
    }

    /**
     * Requests for any missing packets until the specified index. 
     * @param {String} serverAddress
     * @param {Integer} serverPort
     * @param {function} callback
     */
    async requestMissingPackets(serverAddress, serverPort, callback) 
    {
        // Looks for the indeces that have no data in them (which is set to 0).
        let missing = this.chunks.indexOf(NO_DATA);
        let interval = setInterval(()=>{
            // Prevents the function from overflowing the buffer with requests.  
            if(missing == -1)
            {
                clearInterval(interval)
                console.log('No missing');
                callback();
                return;
            }
            
            // Requests the missing packets of the current offset from the server.
            let data = {
                "missing": missing,
                "partition": this.getPartitionOffset()
            }
            
            console.log('Packet ' + missing + ' is missing from partition ' + this.getPartitionOffset());
            let packet = this.makePacket('Missing Packet', data);

            this.client.send(JSON.stringify(packet), serverPort, serverAddress);
            missing = this.chunks.indexOf(NO_DATA);
        }, 0)   
        
    }

    /**
     * Closes the client when the song has finished.
     * @param {Object} client 
     */
    close(client)
    {
        fileStream.push(null);
        console.log('Waiting for audio to finish.')
        speaker.on('finish', () => {
            file.end();
            client.close();
            console.log('File Outputted as ' + this.filename);
            console.log('Closing client.');
        });
    }

    makePacket(header, body)
    {
        return {
            'header': header,
            'body' : body
        }
    }

    getPartitionSize()
    {
        return this.chunks.length;
    }

    incrementPartitionOffset()
    {
        this.partitionOffset++;
    }

    getPartitionOffset()
    {
        return this.partitionOffset;
    }
}
            

