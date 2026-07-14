const mongoose = require("mongoose");
const MeetingSchema = new mongoose.Schema({
    title: { type: String, required: true, maxlength: 200 },
    room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    participants: [{ type: String }],
    organizer: { type: String, required: true }
});
module.exports = mongoose.model("Meeting", MeetingSchema);
