const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const Room = require("./models/Room");
const Meeting = require("./models/Meeting");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// Thay chuỗi kết nối MongoDB Atlas của bạn vào đây
const MONGO_URI = "mongodb://127.0.0.1:27017/meeting_db";
mongoose.connect(MONGO_URI)
    .then(async() => {
        console.log("Kết nối MongoDB thành công!");
        // Tạo sẵn dữ liệu phòng mẫu nếu DB trống để Frontend có cái chọn
        const roomCount = await Room.countDocuments();
        if (roomCount === 0) {
            await Room.insertMany([
                { name: "Phòng họp A (20 chỗ)", capacity: 20 },
                { name: "Phòng họp B (10 chỗ)", capacity: 10 },
                { name: "Phòng họp C (50 chỗ)", capacity: 50 }
            ]);
        }
    })
    .catch(err => console.error("Lỗi kết nối DB:", err));
// 1. API lấy danh sách phòng họp đổ vào Dropdown
app.get("/api/rooms", async(req, res) => {
    try {
        const rooms = await Room.find();
        res.json(rooms);
    } catch (err) {
        res.status(500).json({ message: "Lỗi lấy danh sách phòng" });
    }
});
// 2. API xử lý Tạo lịch họp mới[cite: 1]
app.post("/api/meetings", async(req, res) => {
    try {
        const { title, room, startTime, endTime, participants, description, organizer } = req.body;
        // Ràng buộc bắt buộc nhập[cite: 1]
        if (!title || !room || !startTime || !endTime) {
            return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin bắt buộc!" });
        }
        const start = new Date(startTime);
        const end = new Date(endTime);
        const now = new Date();

        // Ràng buộc thời gian logic[cite: 1]
        if (start < now) {
            return res.status(400).json({ message: "Thời gian bắt đầu không được ở quá khứ!" });
        }
        if (end <= start) {
            return res.status(400).json({ message: "Thời gian kết thúc phải lớn hơn thời gian bắt đầu!" });
        }
        // Thuật toán kiểm tra trùng lịch phòng[cite: 1]
        const roomConflict = await Meeting.findOne({
            room: room,
            startTime: { $lt: end },
            endTime: { $gt: start }
        });
        if (roomConflict) {
            return res.status(409).json({ message: "Phòng họp này đã bị trùng lịch với một cuộc họp khác!" });
        }
        // Kiểm tra cảnh báo người tham gia bận lịch khác[cite: 1]
        let warning = null;
        if (participants && participants.length > 0) {
            const busyUsers = await Meeting.find({
                participants: { $in: participants },
                startTime: { $lt: end },
                endTime: { $gt: start }
            }).distinct("participants");

            if (busyUsers.length > 0) {
                warning = `Lưu ý: Nhân viên (${busyUsers.join(", ")}) đang có lịch họp khác vào thời gian này.`;
            }
        }
        // Lưu cuộc họp vào CSDL
        const newMeeting = new Meeting({
            title,
            room,
            startTime: start,
            endTime: end,
            participants,
            description,
            organizer
        });
        await newMeeting.save();
        res.status(201).json({ message: "Đặt lịch họp thành công!", warning, data: newMeeting });
    } catch (err) {
        res.status(500).json({ message: "Lỗi hệ thống backend", error: err.message });
    }
});
// 3. API Kiểm tra lịch họp trước khi đặt (Nút "Kiểm tra")
app.post("/api/meetings/check", async(req, res) => {
    try {
        const { room, startTime, endTime, participants } = req.body;
        if (!room || !startTime || !endTime) {
            return res.status(400).json({ message: "Vui lòng chọn phòng và thời gian để kiểm tra!" });
        }
        const start = new Date(startTime);
        const end = new Date(endTime);
        if (end <= start) {
            return res.status(400).json({ message: "Thời gian kết thúc phải lớn hơn thời gian bắt đầu!" });
        }
        // Kiểm tra trùng phòng
        const roomConflict = await Meeting.findOne({
            room: room,
            startTime: { $lt: end },
            endTime: { $gt: start }
        }).populate("room");
        if (roomConflict) {
            return res.json({
                status: "conflict_room",
                message: `X PHÒNG BỊ TRÙNG: Phòng đã có lịch họp "${roomConflict.title}" từ ${new Date(roomConflict.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} đến ${new Date(roomConflict.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}.`
            });
        }
        // Kiểm tra nhân viên bận
        if (participants && participants.length > 0) {
            const busyUsers = await Meeting.find({
                participants: { $in: participants },
                startTime: { $lt: end },
                endTime: { $gt: start }
            }).distinct("participants");
            if (busyUsers.length > 0) {
                return res.json({
                    status: "warning_participants",
                    message: `! CẢNH BÁO: Nhân viên (${busyUsers.join(", ")}) đang bận lịch họp khác trong khoảng thời gian này.`
                });
            }
        }
        // Nếu tất cả đều trống
        return res.json({
            status: "available",
            message: "✓ HỢP LỆ: Phòng họp và người tham gia đều sẵn sàng vào thời gian này!"
        });
    } catch (err) {
        res.status(500).json({ message: "Lỗi kiểm tra hệ thống", error: err.message });
    }
});
// 4. API lấy danh sách tất cả các lịch họp đã đặt
app.get("/api/meetings", async(req, res) => {
    try {
        // Lấy danh sách cuộc họp và tự động nạp thông tin phòng (room) đi kèm
        const meetings = await Meeting.find().sort({ startTime: 1 });
        res.json(meetings);
    } catch (err) {
        res.status(500).json({ message: "Lỗi không thể lấy danh sách lịch họp", error: err.message });
    }
});
// 5. API xóa một lịch họp theo ID
app.delete("/api/meetings/:id", async(req, res) => {
    try {
        const { id } = req.params;
        const deletedMeeting = await Meeting.findByIdAndDelete(id);
        if (!deletedMeeting) {
            return res.status(404).json({ message: "Không tìm thấy lịch họp cần xóa!" });
        }
        res.json({ message: "Xóa lịch họp thành công!" });
    } catch (err) {
        res.status(500).json({ message: "Lỗi hệ thống khi xóa lịch họp", error: err.message });
    }
});
// 6. API cập nhật (Sửa) lịch họp theo ID
app.put("/api/meetings/:id", async(req, res) => {
    try {
        const { id } = req.params;
        const { title, room, startTime, endTime, participants, description } = req.body;
        if (!title || !room || !startTime || !endTime) {
            return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin bắt buộc!" });
        }
        const start = new Date(startTime);
        const end = new Date(endTime);
        if (end <= start) {
            return res.status(400).json({ message: "Thời gian kết thúc phải lớn hơn thời gian bắt đầu!" });
        }
        // Kiểm tra trùng phòng (bỏ qua chính lịch họp đang sửa đổi này dựa theo ID)
        const roomConflict = await Meeting.findOne({
            _id: { $ne: id }, // Không kiểm tra chính nó
            room: room,
            startTime: { $lt: end },
            endTime: { $gt: start }
        });
        if (roomConflict) {
            return res.status(409).json({ message: "Phòng họp đã bị trùng lịch với cuộc họp khác trong khoảng thời gian này!" });
        }
        // Cập nhật dữ liệu mới vào DB
        const updatedMeeting = await Meeting.findByIdAndUpdate(
            id, { title, room, startTime: start, endTime: end, participants, description }, { new: true }
        );
        if (!updatedMeeting) {
            return res.status(404).json({ message: "Không tìm thấy lịch họp để cập nhật!" });
        }
        res.json({ message: "Cập nhật lịch họp thành công!", data: updatedMeeting });
    } catch (err) {
        res.status(500).json({ message: "Lỗi hệ thống khi sửa lịch họp", error: err.message });
    }
});
const PORT = 3000;
app.listen(PORT, () => console.log(`Server đang chạy tại http://localhost:${PORT}`));
