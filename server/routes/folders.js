import express from 'express';
import hash from 'object-hash';

import verifyUser from '../VerifyUser';
import Folder from '../models/folders';
import XList from '../models/xlist';
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
    .catch(err =>
      res.status(404).json({ error: `authentication failed!\n${err}` })
    );
};

app.post('/create', auth, (req, res) => {
  // If folder is root, get the root folder's id
  let { parentFolder } = req.body;
  if (parentFolder === 'root') parentFolder = req.user.root;
  // check whether the supplied folder exists or not
  Folder.findOne({ id: parentFolder })
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
        folders: [],
        notes: [],
        // copy the parent folder access-list
        xlist: result.xlist.slice()
      };
      // Generate unique id for the folder
      createFolder.id = hash(createFolder);
      createFolder.path = `${result.path}$${createFolder.id}`;

      const newFolder = new Folder(createFolder);
      // Add the folder's id to the list of its parent's folders' list
      const updatePromise = Folder.findOneAndUpdate(
        { id: parentFolder },
        { $push: { folders: createFolder.id } }
      );
      const savePromise = newFolder.save();

      return Promise.all([updatePromise, savePromise]);
    })
    .then(([parent, folder]) => res.status(200).json(folder))
    .catch(err => {
      const code = err.code || 500;
      const reason = err.reason || 'Internal server error';
      res.status(code).json({ reason });
    });
});

/*
 * Returns the folders(or notes) owned by the requesting user
 * inside a folder-id mentioned
 *
 * for getting the notes inside the mentioned folder the
 * 'type' is 'notes' and for getting the folders it is 'folders'
 */
app.get('/:type/:id', auth, (req, res) => {
  if (req.params.type !== 'notes' && req.params.type !== 'folders')
    return res.status(404).json({ error: 'Invalid path!' });

  Folder.findOne({ id: req.params.id })
    .then(folder => {
      if (!folder)
        return res.status(400).json({ folder: "Folder doesn't exists!" });
      if (req.params.type === 'notes') return res.json({ notes: folder.notes });
      return res.json({ folders: folder.folders });
    })
    .catch(err => {
      res.status(500).send(err);
    });
  return 0;
});

/*
 * get all the users who has specified access to specified folder
 * for getting the read-only accessible use
 * 'type' = 'read' and for read-write use 'type' = 'write'
 */
app.get('/access/:type/:id', auth, (req, res) => {
  if (req.params.type !== 'read' && req.params.type !== 'write')
    return res.status(404).json({ error: 'Invalid end-point' });

  Folder.findOne({ id: req.params.id })
    .then(folder => {
      if (!folder)
        return res
          .status(400)
          .json({ folder: "Requested folder doesn't exists" });

      const type = req.params.type === 'read' ? 0 : 1;
      const result = folder.xlist.filter(x => x.visibility === type);
      return res.json({ xlist: result });
    })
    .catch(err => {
      res.status(500).send(err);
    });
  return 0;
});

/*
 * give the specified access to a particular user
 * for read-only access use 'type' = 'read' and for
 * read-write access use 'type' = 'write'
 *
 * body-parameters : email[](array of email-id (may be empty))-required param
 *                   xlist(xlist-name (not a mandatory param))
 */
app.post('/access/:type/:id', auth, (req, res) => {
  if (req.params.type !== 'read' && req.params.type !== 'write')
    return res.status(404).json({ error: 'Invalid end-point' });

  // check whether the body parameters are sent correctly or not
  if (!req.body.email || !Array.isArray(req.body.email))
    return res.status(400).json({
      email:
        'email field must be an array of emails of user and is a required parameter'
    });

  const usersList = req.body.email;
  const type = req.params.type === 'read' ? 0 : 1;

  const folderPromise = Folder.findOne({ id: req.params.id });
  // if xlist is present then check for it's validity
  if (req.body.xlist) {
    const xlistPromise = XList.findOne({
      name: req.body.xlist,
      owner: req.user.email
    });
    Promise.all([xlistPromise, folderPromise])
      .then(([xlist, folder]) => {
        if (!xlist) {
          res.status(400).json({ xlist: "Mentinoed xlist doesn't exists" });
          return null;
        }
        if (!folder) {
          res.status(400).json({ folder: "Mentioned folder doesn't exists" });
          return null;
        }

        for (let i = 0; i < xlist.members.length; i += 1)
          usersList.push(xlist.members[i]);

        const userListWithPermission = usersList.map(x => {
          return {
            email: x,
            visibility: type
          };
        });

        const regexString = `^${folder.path}[a-zA-Z0-9$]*`;
        return Folder.update(
          { owner: req.user.id, path: { $regex: new RegExp(regexString) } },
          { $push: { xlist: { $each: userListWithPermission.slice() } } }
        );
      })
      .then(result => {
        if (!result) return;
        res.send('Successfully updated!');
      })
      .catch(err => {
        return res.status(500).send(err);
      });
    return 0;
  }

  folderPromise
    .then(folder => {
      if (!folder) {
        res.status(400).json({ folder: "Mentioned folder doesn't exists" });
        return null;
      }
      const userListWithPermission = usersList.map(x => {
        return {
          email: x,
          visibility: type
        };
      });
      const regexString = `^${folder.path}[a-zA-Z0-9$]*`;
      return Folder.update(
        { owner: req.user.id, path: { $regex: new RegExp(regexString) } },
        { $push: { xlist: { $each: userListWithPermission.slice() } } }
      );
    })
    .then(result => {
      if (!result) return;
      res.send('Successfully updated');
    })
    .catch(err => {
      res.status(500).send(err);
    });

  return 0;
});

/*
 * delete specified folder
 */
app.delete('/folder/remove/:id', auth, (req, res) => {
  Folder.findOne({ id: req.params.id })
    .then(folder => {
      if (!folder) {
        res.status(400).json({ folder: "Mentioned folder doesn't exists" });
        return null;
      }

      const regexString = `^${folder.path}[a-zA-Z0-9$]*`;
      return Folder.remove({ path: new RegExp(regexString) });
    })
    .then(deletedFolder => {
      // response is already sent to the client
      if (!deletedFolder) return null;

      const listOfNotesToDelete = [];
      for (let i = 0; i < deletedFolder.length; i += 1) {
        const notes = deletedFolder[i].notes;
        for (let j = 0; j < notes.length; j += 1)
          listOfNotesToDelete.push(notes[j]);
      }

      return Notes.remove({ id: { $in: listOfNotesToDelete } });
    })
    .then(result => {
      if (!result) return;
      res.send('Deleted successfully!');
    })
    .catch(err => {
      res.status(500).send(err);
    });
});

export default app;
