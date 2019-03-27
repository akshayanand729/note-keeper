import express from 'express';
import hash from 'object-hash';

import verifyUser from '../VerifyUser';
import Folder from '../models/folders';
import Notes from '../models/notes';

// eslint-disable-next-line new-cap
const app = express.Router();

// authenticate the user and set the req.user to it's properties
const auth = (req, res, next) => {
  // Get the auth token of the user which sent the request
  const idToken = req.header('Authorization');
  // Verify the user and then continue further steps
  verifyUser(idToken)
    .then(user => {
      req.user = user;
      next();
    })
    .catch(() => res.status(404).json({ error: 'authentication failed!' }));
};

app.post('/create', auth, (req, res) => {
  const parentFolder = req.body.folder;
  Folder.findOne({
    id: parentFolder,
    owner: req.user.uid
  })
    .then(result => {
      if (!result) {
        res
          .status(400)
          .json({ Folder: "Requested parent folder doesn't exists" });
        return null;
      }
      // parentFolder exisits and we have it's reference
      const { title } = req.body;
      // Create folder using data extracted
      const createFolder = {
        name: title,
        parentFolder,
        timestamp: Date.now(),
        owner: req.user.uid,
        // copy the parent folder access-list
        xlist: result.xlist.slice()
      };
      // Generate unique id for the folder
      createFolder.id = hash(createFolder);
      createFolder.path = `${result.path}\\$${createFolder.id}`;

      const newFolder = new Folder(createFolder);
      return newFolder.save();
    })
    .then(result => {
      /* console.log(result); */
      res.status(200).json(result);
    })
    .catch(err => {
      /* console.log(err); */
      const code = err.code || 500;
      const reason = err.reason || 'Internal server error';
      res.status(code).json({ reason });
    });
});

/*
 * Returns the folders(or notes) owned by the requesting user
 * inside a folder-id mentioned
 */
app.get('/get/:id', auth, (req, res) => {
  // TODO: Return folder details depending upon the acess
  Folder.find({ parentFolder: req.params.id, owner: req.user.uid })
    .then(folders => {
      if (folders === null)
        throw Object({ code: 400, reason: 'Folder not found' });
      res.send(folders);
    })
    .catch(err => {
      res.status(500).send(err);
    });
});

/*
 * delete specified folder
 */
app.delete('/delete/:id', auth, (req, res) => {
  let regex;

  Folder.findOne({ id: req.params.id })
    .then(folder => {
      if (!folder) {
        res.status(400).json({ folder: "Mentioned folder doesn't exists" });
        return null;
      }

      regex = new RegExp(`${folder.path}`);
      /* console.log(regex); */
      return Folder.deleteMany({ path: regex });
    })
    .then(deleteRes => {
      // response is already sent to the client
      if (!deleteRes) return null;
      /* console.log(deleteRes); */
      return Notes.deleteMany({ path: regex });
    })
    .then(deleteRes => {
      if (!deleteRes) return;
      res.send('Deleted successfully!');
    })
    .catch(err => {
      res.status(500).send(err);
    });
});

export default app;
