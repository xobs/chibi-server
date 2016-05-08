var ui = {
  mode: null,
  saveState: false,
  sendState: false,
  modData: null,
  byteArray: null,
  fileSelect: 1,
  playCount: 0,

  init: function(fn) {
    this.filename = fn;             // Path to filename.
    this.modData = new modulator(); // the modulator object contains our window's audio context
  },

  startSending: function() {
    if (this.sendState)
      return;
    this.sendState = true;

    // fetch a file and transcode it
    var fileReq = new XMLHttpRequest();
    fileReq.open("GET", this.fileName, true);
    fileReq.responseType = "arraybuffer";

    fileReq.onload = function(oEvent) {
      var arrayBuffer = fileReq.response;
      if (arrayBuffer) {
        self.ui.byteArray = new Uint8Array(arrayBuffer);

        self.ui.playCount = 0;
        self.ui.transcodeFile(0);
      }
    }
    fileReq.send(); // this request is asynchronous
  },

  stopSending: function() {
    this.sendState = false;
  },

  // this is the core function for transcoding
  // two object variables must be set:
  // byteArray, and playCount.
  // byteArray is the binary file to transmit
  // playCount keeps track of how many times the entire file has been replayed

  // the parameter to this, "index", is a packet counter. We have to recursively call
  // transcodeFile using callbacks triggered by the completion of audio playback. I couldn't
  // think of any other way to do it.
  transcodeFile: function(index) {

    if (!self.ui.sendState)
      return;

    var fileLen = self.ui.byteArray.length;
    var blocks = Math.ceil(fileLen / 256);

    // index 0 & 1 create identical control packets. We transmit the control packet
    // twice in the beginning because (a) it's tiny and almost free and (b) if we
    // happen to miss it, we waste an entire playback cycle before we start committing
    // data to memory
    if (index == 0 || index == 1) {
      var ctlPacket = self.ui.makeCtlPacket(self.ui.byteArray.subarray(0,
        fileLen));

      self.ui.modData.modulate(ctlPacket);
      self.ui.modData.playLoop(self.ui, index + 1);
      self.ui.modData.drawWaveform();
    } else {
      // data index starts at 2, due to two sends of the control packet up front
      var i = index - 2;
      // handle whole blocks
      if (i < blocks - 1) {
        var dataPacket = self.ui.makeDataPacket(self.ui.byteArray.subarray(
          i * 256, i * 256 + 256), i);
        self.ui.modData.modulate(dataPacket);
        self.ui.modData.playLoop(self.ui, index + 1);
        self.ui.modData.drawWaveform();
      } else {
        // handle last block of data, which may not be 256 bytes long
        var dataPacket = self.ui.makeDataPacket(self.ui.byteArray.subarray(
          i * 256, fileLen), i);
        self.ui.modData.modulate(dataPacket);
        self.ui.modData.playLoop(self.ui, index + 1);
        self.ui.modData.drawWaveform();
      }
    }
  },
  makeCtlPacket: function(data) {
    // parameters from microcontroller spec. Probably a better way
    // to do this in javascript, but I don't know how (seems like "const" could be used, but not universal)
    var bytePreamble = [00, 00, 00, 00, 0xaa, 0x55, 0x42];
    var byteVersion = [0x81];
    var pktLength = data.length;
    var byteLength = [pktLength & 0xFF, (pktLength >> 8) & 0xFF, (pktLength >>
      16) & 0xFF, (pktLength >> 24) & 0xFF];
    var pktFullhash = murmurhash3_32_gc(data, 0x32d0babe); // 0x32d0babe by convention
    var guidStr = SparkMD5.hash(String.fromCharCode.apply(null, data),
      false);
    var pktGuid = [];

    for (var i = 0; i < guidStr.length - 1; i += 2)
      pktGuid.push(parseInt(guidStr.substr(i, 2), 16));

    var packetlen = bytePreamble.length + byteVersion.length + byteLength.length +
      4 + pktGuid.length + 4 + 1;
    var pkt = new Uint8Array(packetlen);
    var pktIndex = 0;
    for (i = 0; i < bytePreamble.length; i++) {
      pkt[pktIndex++] = bytePreamble[i];
    }
    pkt[pktIndex++] = byteVersion[0];
    for (i = 0; i < byteLength.length; i++) {
      pkt[pktIndex++] = byteLength[i];
    }
    pkt[pktIndex++] = pktFullhash & 0xFF;
    pkt[pktIndex++] = (pktFullhash >> 8) & 0xFF;
    pkt[pktIndex++] = (pktFullhash >> 16) & 0xFF;
    pkt[pktIndex++] = (pktFullhash >> 24) & 0xFF;
    for (i = 0; i < 16; i++) {
      pkt[pktIndex++] = pktGuid[i];
    }

    var hash = murmurhash3_32_gc(pkt.subarray(bytePreamble.length, 24 +
      bytePreamble.length + byteVersion.length), 0xdeadbeef); // deadbeef is just by convention
    pkt[pktIndex++] = hash & 0xFF;
    pkt[pktIndex++] = (hash >> 8) & 0xFF;
    pkt[pktIndex++] = (hash >> 16) & 0xFF;
    pkt[pktIndex++] = (hash >> 24) & 0xFF
    pkt[pktIndex] = 0xFF; // terminate with 0xFF to let last bit demodulate correctly

    return pkt;
  },
  makeDataPacket: function(dataIn, blocknum) {
    var data;
    var i;
    if (dataIn.length != 256) {
      // if our data array isn't a whole packet in length, pad it out with FF's
      data = new Uint8Array(256);
      for (i = 0; i < dataIn.length; i++) {
        data[i] = dataIn[i];
      }
      for (; i < 256; i++) {
        data[i] = 0xFF; // 1's pad out the final data packet
      }
    } else {
      data = dataIn;
    }
    // now assemble the packet
    var preamble = [00, 00, 00, 00, 0xaa, 0x55, 0x42];
    var sector = [0x01, blocknum & 0xFF, (blocknum >> 8) & 0xFF]; // version 1
    // 256 byte payload, preamble, sector offset + 4 bytes hash + 1 byte stop
    var packetlen = 256 + preamble.length + sector.length + 4 + 1;

    var buffer = new Uint8Array(packetlen);
    for (i = 0; i < preamble.length; i++) {
      buffer[i] = preamble[i];
    }
    for (var j = 0; i < sector.length + preamble.length; i++, j++) {
      buffer[i] = sector[j];
    }
    for (j = 0; i < packetlen - 1 - 4; i++, j++) {
      buffer[i] = data[j];
    }

    hash = murmurhash3_32_gc(buffer.subarray(preamble.length, 256 +
      preamble.length + sector.length), 0xdeadbeef);
    buffer[i++] = hash & 0xFF;
    buffer[i++] = (hash >> 8) & 0xFF;
    buffer[i++] = (hash >> 16) & 0xFF;
    buffer[i++] = (hash >> 24) & 0xFF
    buffer[i] = 0xFF; // terminate with 0xFF to let last bit demodulate correctly

    // now stripe the buffer to ensure transitions for baud sync
    // don't stripe the premable or the hash
    for (i = 8; i < (buffer.length - 5); i++) {
      if ((i % 16) == 14)
        buffer[i] ^= 0x55;
      else if ((i % 16) == 6)
        buffer[i] ^= 0xaa;
    }

    return buffer;
  },

  // once all audio is done playing, call this to reset UI elements to idle state
  audioEndCB: function() {
    this.sendState = false;
  },
}
