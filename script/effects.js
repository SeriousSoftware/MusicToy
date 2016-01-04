/**
 @class Overdrive distortion effect
 @extends SynthNode
 */
function Overdrive() {
    this.name = 'overdrive';

    /**
     Input gain
     */
    this.gain = 1;

    /**
     Clipping threshold
     */
    this.threshold = 0.7;

    /**
     Clipping factor (ratio is 1 / factor)
     */
    this.factor = 1;

    // Sound Input
    new SynthInput(this, 'input');

    // Sound output
    new SynthOutput(this, 'output');
}
Overdrive.prototype = new SynthNode();

/**
 Update the outputs based on the inputs
 */
Overdrive.prototype.update = function (time, sampleRate) {
    // If this input has no available data, do nothing
    if (!this.input.hasData())
        return;

    // Get the input buffer
    var inBuf = this.input.getBuffer();

    // Get the output buffer
    var outBuf = this.output.getBuffer();

    var f = 1 / this.factor;

    // For each sample
    for (var i = 0; i < inBuf.length; ++i) {
        var s = inBuf[i] * this.gain;

        var absS = Math.abs(s);

        var d = absS - this.threshold;

        if (d > 0) {
            absS = (absS - d) + (f * d);

            s = (s > 0) ? absS : -absS;
        }

        outBuf[i] = s;
    }
};

