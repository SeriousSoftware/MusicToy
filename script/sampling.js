/** @class Loads a sample asynchronously from a URL
 */
function Sample(url) {
    /**
     Audio data buffer, undefined until loaded
     */
    this.buffer = undefined;

    console.log('loading sample "' + url + '"');

    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";

    var that = this;
    xhr.onload = function () {
        try {
            audioCtx.decodeAudioData(
                xhr.response,
                function (audioBuffer) {
                    var f32buffer = audioBuffer.getChannelData(0);
                    var f64buffer = new Float64Array(f32buffer.length);
                    for (var i = 0; i < f32buffer.length; ++i)
                        f64buffer[i] = f32buffer[i];

                    that.buffer = f64buffer;
                }
            );
        }

        catch (e) {
            console.error('failed to load "' + url + '"');
            console.error(e.toString());
        }

        //console.log('loaded sample "' + url + '" (' + that.buffer.length + ')');
    };

    xhr.send();
}

/**
 @class Basic sample-mapping instrument
 @extends SynthNode
 */
function SampleKit() {
    /**
     Array of resources, indexed by MIDI note numbers
     */
    this.samples = [];

    /**
     Array of active (currently playing) resources
     */
    this.actSamples = [];

    // Sound output
    new SynthOutput(this, 'output');

    this.name = 'sample-kit';
}
SampleKit.prototype = new SynthNode();

/**
 Map a sample to a given note
 */
SampleKit.prototype.mapSample = function (note, sample, volume) {
    if (typeof note === 'string')
        note = new Note(note);

    if (typeof sample === 'string')
        sample = new Sample(sample);

    if (volume === undefined)
        volume = 1;

    this.samples[note.noteNo] = {
        data: sample,
        volume: volume
    }
};

/**
 Process an event
 */
SampleKit.prototype.processEvent = function (evt, time) {
    // Note-on event
    if (evt instanceof NoteOnEvt) {
        // Get the note
        var note = evt.note;

        var sample = this.samples[note.noteNo];

        // If no sample is mapped to this note, do nothing
        if (sample === undefined)
            return;

        // If the sample is not yet loaded, do nothing
        if (sample.data.buffer === undefined)
            return;

        // Add a new instance to the active list
        this.actSamples.push({
            sample: sample,
            pos: 0
        });
    }

    // All notes off event
    else if (evt instanceof AllNotesOffEvt) {
        this.actSamples = [];
    }

    // By default, do nothing
};

/**
 Update the outputs based on the inputs
 */
SampleKit.prototype.update = function (time, sampleRate) {
    // If there are no active resources, do nothing
    if (this.actSamples.length === 0)
        return;

    // Get the output buffer
    var outBuf = this.output.getBuffer(0);

    // Initialize the output to 0
    for (var i = 0; i < outBuf.length; ++i)
        outBuf[i] = 0;

    // For each active sample instance
    for (var i = 0; i < this.actSamples.length; ++i) {
        var actSample = this.actSamples[i];

        var inBuf = actSample.sample.data.buffer;

        var volume = actSample.sample.volume;

        assert(
            inBuf instanceof Float64Array,
            'invalid input buffer'
        );

        var playLen = Math.min(outBuf.length, inBuf.length - actSample.pos);

        for (var outIdx = 0; outIdx < playLen; ++outIdx)
            outBuf[outIdx] += inBuf[actSample.pos + outIdx] * volume;

        actSample.pos += playLen;

        // If this sample is done playing
        if (actSample.pos === inBuf.length) {
            // Remove the sample from the active list
            this.actSamples.splice(i, 1);
            --i;
        }
    }
};

/**
 @class Sample-based pitch-shifting instrument
 @extends SynthNode
 */
function SampleInstr(sample, centerNote) {
    if (typeof sample === 'string')
        sample = new Sample(sample);

    if (typeof centerNote === 'string')
        centerNote = new Note(centerNote);

    /**
     Sample data
     */
    this.sample = sample;

    /**
     Center note/pitch for the sample
     */
    this.centerNote = centerNote;

    /**
     List of active notes
     */
    this.actNotes = [];

    // TODO: loop points

    // Sound output
    new SynthOutput(this, 'output');

    this.name = 'sample-instr';
}
SampleInstr.prototype = new SynthNode();

/**
 Process an event
 */
SampleInstr.prototype.processEvent = function (evt, time) {
    // Note-on event
    if (evt instanceof NoteOnEvt) {
        // If the sample is not yet loaded, stop
        if (this.sample.buffer === undefined)
            return;

        // Get the note
        var note = evt.note;

        var centerFreq = this.centerNote.getFreq();
        var noteFreq = note.getFreq();
        var freqRatio = noteFreq / centerFreq;

        // Add an entry to the active note list
        this.actNotes.push({
            pos: 0,
            freqRatio: freqRatio
        });
    }

    // Note-off event
    if (evt instanceof NoteOffEvt) {
        // Get the note
        var note = evt.note;

        // TODO: loop points
    }

    // All notes off event
    else if (evt instanceof AllNotesOffEvt) {
        this.actNotes = [];
    }

    // By default, do nothing
};

/**
 Update the outputs based on the inputs
 */
SampleInstr.prototype.update = function (time, sampleRate) {
    // If there are no active notes, do nothing
    if (this.actNotes.length === 0)
        return;

    // Get the output buffer
    var outBuf = this.output.getBuffer(0);

    // Initialize the output to 0
    for (var i = 0; i < outBuf.length; ++i)
        outBuf[i] = 0;

    // Get the sample buffer
    var inBuf = this.sample.buffer;

    // For each active note
    for (var i = 0; i < this.actNotes.length; ++i) {
        var actNote = this.actNotes[i];

        // Compute the displacement between sample points
        var disp = actNote.freqRatio;

        var pos = actNote.pos;

        // For each output sample to produce
        for (var outIdx = 0; outIdx < outBuf.length; ++outIdx) {
            var lIdx = Math.floor(pos);
            var rIdx = lIdx + 1;

            if (rIdx >= inBuf.length)
                break;

            var lVal = inBuf[lIdx];
            var rVal = inBuf[rIdx];
            outBuf[outIdx] = lVal * (rIdx - pos) + rVal * (pos - lIdx);

            // Update the sample position
            pos += disp;
        }

        // Store the final sample position
        actNote.pos = pos;

        // If the note is done playing
        if (pos >= inBuf.length) {
            // Remove the note from the active list
            this.actNotes.splice(i, 1);
            --i;
        }
    }
};

