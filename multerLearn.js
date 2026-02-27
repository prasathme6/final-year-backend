import multer from "multer";


const storage = multer.diskStorage({
  destination: "uploads/learn",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "_" + file.originalname);
  }
});

const profileStorage = multer.diskStorage({
  destination: "uploads/profile",
  filename: (req, file, cb) => {
    cb(null, req.session.student + "_" + Date.now() + "_" + file.originalname);
  }
});

export const uploadProfile = multer({ storage: profileStorage });


export const uploadLearn = multer({ storage });
