//============================================================================
// Music piece implementation
//============================================================================

/**
 @class Musical piece implementation.
 */
function Piece(synthNet) {
    assert(
        synthNet instanceof SynthNet || synthNet === undefined,
        'invalid synth net'
    );

    /**
     Synthesis network used by this piece
     */
    this.synthNet = synthNet;

    /**
     Music/info tracks
     */
    this.tracks = [];

    /**
     Current playback time/position
     */
    this.playTime = 0;

    /**
     Loop time
     */
    this.loopTime = 0;

    /**
     Previous update time
     */
    this.prevTime = 0;

    /**
     Tempo in beats per minute
     */
    this.beatsPerMin = 140;

    /**
     Time signature numerator, beats per bar
     */
    this.beatsPerBar = 4;

    /**
     Time signature denominator, note value for each beat
     */
    this.noteVal = 4;
}

/**
 Add a track to the piece
 */
Piece.prototype.addTrack = function (track) {
    assert(
        track instanceof Track,
        'invalid track'
    );

    this.tracks.push(track);

    return track;
};

/**
 Get the time offset for a beat number. This number can be fractional.
 */
Piece.prototype.beatTime = function (beatNo) {
    var beatLen = 60 / this.beatsPerMin;

    return beatLen * beatNo;
};

/**
 Get the length in seconds for a note value multiple
 */
Piece.prototype.noteLen = function (len) {
    // By default, use the default note value
    if (len === undefined)
        len = 1;

    var beatLen = 60 / this.beatsPerMin;

    var barLen = beatLen * this.beatsPerBar;

    var noteLen = barLen / this.noteVal;

    return len * noteLen * 0.99;
};

/**
 Helper methods to add notes to the track.
 Produces a note-on and note-off event pair.
 */
Piece.prototype.makeNote = function (track, beatNo, note, len, vel) {

    assert(
        note instanceof Note ||
        typeof note === 'string',
        'invalid note'
    );

    if (typeof note === 'string')
        note = new Note(note);

    // By default, the velocity is 100%
    if (vel === undefined)
        vel = 1;

    // Convert the note time to a beat number        
    var time = this.beatTime(beatNo);

    // Get the note length in seconds
    var noteLen = this.noteLen(len);

    // Create the note on and note off events
    var noteOn = new NoteOnEvt(time, note, vel);
    var noteOff = new NoteOffEvt(time + noteLen, note);

    // Add the events to the track
    track.addEvent(noteOn);
    track.addEvent(noteOff);
};

/**
 Set the playback position/time
 */
Piece.prototype.setTime = function (time) {
    this.playTime = time;
};

/**
 Dispatch synthesis events up to the current time
 */
Piece.prototype.dispatch = function (curTime, realTime) {
    // Do the dispatch for each track
    for (var i = 0; i < this.tracks.length; ++i) {
        var track = this.tracks[i];

        track.dispatch(this.prevTime, curTime, realTime);
    }

    // Store the last update time/position
    this.prevTime = curTime;
};

/**
 Called when stopping the playback of a piece
 */
Piece.prototype.stop = function () {
    // If a synthesis network is attached to this piece
    if (this.synthNet !== undefined) {
        // Send an all notes off event to all synthesis nodes
        var notesOffEvt = new AllNotesOffEvt();
        for (var i = 0; i < this.synthNet.nodes.length; ++i) {
            var node = this.synthNet.nodes[i];
            node.processEvent(notesOffEvt);
        }
    }

    // Set the playback position past all events
    this.playTime = Infinity;
};

/**
 Create a handler for real-time audio generation
 */
Piece.prototype.makeHandler = function () {
    var synthNet = this.synthNet;
    var piece = this;

    var sampleRate = synthNet.sampleRate;

    // Output node of the synthesis network
    var outNode = synthNet.outNode;

    // Current playback time
    var curTime = piece.playTime;
    var realTime = piece.playTime;

    // Audio generation function
    function genAudio(evt) {
        //var startTime = (new Date()).getTime();

        var numChans = evt.outputBuffer.numberOfChannels;
        var numSamples = evt.outputBuffer.getChannelData(0).length;

        // If the playback position changed, update the current time
        if (piece.playTime !== curTime) {
            console.log('playback time updated');
            curTime = piece.playTime;
        }

        assert(
            numChans === outNode.numChans,
            'mismatch in the number of output channels'
        );

        assert(
            numSamples % SYNTH_BUF_SIZE === 0,
            'the output buffer size must be a multiple of the synth buffer size'
        );

        // Until all resources are produced
        for (var smpIdx = 0; smpIdx < numSamples; smpIdx += SYNTH_BUF_SIZE) {
            // Update the piece, dispatch track events
            piece.dispatch(curTime, realTime);

            // Generate the sample values
            /*var values =*/ synthNet.genOutput(realTime);
            // Copy the values for each channel
            for (var chnIdx = 0; chnIdx < numChans; ++chnIdx) {
                var srcBuf = outNode.getBuffer(chnIdx);
                var dstBuf = evt.outputBuffer.getChannelData(chnIdx);

                for (var i = 0; i < SYNTH_BUF_SIZE; ++i)
                    dstBuf[smpIdx + i] = srcBuf[i];
            }

            // Update the current time based on sample rate
            curTime += SYNTH_BUF_SIZE / sampleRate;
            realTime += SYNTH_BUF_SIZE / sampleRate;

            // If we lust passed the loop time, go back to the start
            if (piece.playTime <= piece.loopTime &&
                curTime > piece.loopTime) {
                piece.dispatch(piece.loopTime + 0.01, realTime);

                curTime = 0;
                piece.prevTime = 0;
            }

            // Update the current playback position
            piece.playTime = curTime;
        }

/*
        var endTime = (new Date()).getTime();
        var compTime = (endTime - startTime) / 1000;
        var soundTime = (numSamples / synthNet.sampleRate);
        var cpuUse = (100 * compTime / soundTime).toFixed(1);
        console.log('cpu use: ' + cpuUse + '%');
*/
    }

    // Return the handler function
    return genAudio;
};

/**
 @class Synthesis event track implementation. Produces events and sends them
 to a target synthesis node.
 */
function Track(target) {
    assert(
        target instanceof SynthNode || target === undefined,
        'invalid target node'
    );

    /**
     Target synthesis node to send events to
     */
    this.target = target;

    /**
     Events for this track
     */
    this.events = [];
}

/**
 Add an event to the track
 */
Track.prototype.addEvent = function (evt) {
    this.events.push(evt);

    // If the event is being added at the end of the track, stop
    if (this.events.length === 1 ||
        evt.time >= this.events[this.events.length - 2].time)
        return;

    // Sort the events
    this.events.sort(function (a, b) {
        return a.time - b.time;
    });
};

/**
 Dispatch the events between the previous update time and
 the current time, inclusively.
 */
Track.prototype.dispatch = function (prevTime, curTime, realTime) {
    if (this.target === undefined)
        return;

    if (this.events.length === 0)
        return;

    // Must play all events from the previous time (inclusive) up to the
    // current time (exclusive).
    //
    // Find the mid idx where we are at or just past the previous time.

    var minIdx = 0;
    var maxIdx = this.events.length - 1;

    var midIdx = 0;

    while (minIdx <= maxIdx) {
        midIdx = Math.floor((minIdx + maxIdx) / 2);

        //console.log(midIdx);

        var midTime = this.events[midIdx].time;

        var leftTime = (midIdx === 0) ? -Infinity : this.events[midIdx - 1].time;

        if (leftTime < prevTime && midTime >= prevTime)
            break;

        if (midTime < prevTime)
            minIdx = midIdx + 1;
        else
            maxIdx = midIdx - 1;
    }

    // If no event to dispatch were found, stop
    if (minIdx > maxIdx)
        return;

    // Dispatch all events up to the current time (exclusive)
    for (var idx = midIdx; idx < this.events.length; ++idx) {
        var evt = this.events[idx];

        if (evt.time >= curTime)
            break;

        console.log('Dispatch: ' + evt);

        this.target.processEvent(evt, realTime);
    }
};

/**
 Clear all the events from this track
 */
Track.prototype.clear = function () {
    this.events = [];
};

//============================================================================
// Synthesis events
//============================================================================

/**
 @class Base class for all synthesis events.
 */
function SynthEvt() {
    /**
     Event occurrence time
     */
    this.time = 0;
}

/**
 Format a synthesis event string representation
 */
SynthEvt.formatStr = function (evt, str) {
    return evt.time.toFixed(2) + ': ' + str;
};

/**
 Default string representation for events
 */
SynthEvt.prototype.toString = function () {
    return SynthEvt.formatStr(this, 'event');
};

/**
 @class Note on event
 */
function NoteOnEvt(time, note, vel) {
    // By default, use the C4 note
    if (note === undefined)
        note = new Note(C4_NOTE_NO);

    // By default, 50% velocity
    if (vel === undefined)
        vel = 0.5;

    /**
     Note
     */
    this.note = note;

    /**
     Velocity
     */
    this.vel = vel;

    // Set the event time
    this.time = time;
}
NoteOnEvt.prototype = new SynthEvt();

/**
 Default string representation for events
 */
NoteOnEvt.prototype.toString = function () {
    return SynthEvt.formatStr(this, 'note-on ' + this.note);
};

/**
 @class Note off event
 */
function NoteOffEvt(time, note) {
    // By default, use the C4 note
    if (note === undefined)
        note = new Note(C4_NOTE_NO);

    /**
     Note
     */
    this.note = note;

    // Set the event time
    this.time = time;
}
NoteOffEvt.prototype = new SynthEvt();

/**
 Default string representation for events
 */
NoteOffEvt.prototype.toString = function () {
    return SynthEvt.formatStr(this, 'note-off ' + this.note);
};

/**
 @class All notes off event. Silences instruments.
 */
function AllNotesOffEvt(time) {
    this.time = time;
}
AllNotesOffEvt.prototype = new SynthEvt();

/**
 Default string representation for events
 */
AllNotesOffEvt.prototype.toString = function () {
    return SynthEvt.formatStr(this, 'all notes off');
};

