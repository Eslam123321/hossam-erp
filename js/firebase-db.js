/* ==========================================================================
   Hossam ERP - Firebase Firestore & Authentication Layer
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyDCtVdcla0G_cu2XahPFA5BTBwROhtbvPc",
  authDomain: "hossam-erp-4da93.firebaseapp.com",
  projectId: "hossam-erp-4da93",
  storageBucket: "hossam-erp-4da93.firebasestorage.app",
  messagingSenderId: "726111893979",
  appId: "1:726111893979:web:420995e6dfaca6fde74ffe"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Ensure authenticated session with persistent local storage
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

// Auto-authenticate with admin if no user is signed in
auth.onAuthStateChanged((user) => {
  if (!user) {
    auth.signInWithEmailAndPassword("admin@hossam-erp.com", "01095412229").catch((err) => {
      console.warn("Auto sign-in:", err.message);
    });
  }
});

// Global Firebase Database Adapter (window.FDB)
const FDB = {
  auth,
  db,

  // Helper to ensure valid email for Firebase Auth if username is provided
  formatEmail(identifier) {
    if (!identifier) return '';
    const clean = identifier.trim();
    if (clean.includes('@')) return clean;
    return `${clean.toLowerCase().replace(/[^a-z0-9_]/g, '')}@hossam-erp.com`;
  },

  // 1. Login with Firebase Auth
  async login(identifier, password) {
    try {
      const email = this.formatEmail(identifier);
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      return { success: true, user: userCredential.user };
    } catch (error) {
      console.warn('Firebase Auth login error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  },

  // 2. Logout
  async logout() {
    try {
      await auth.signOut();
      return { success: true };
    } catch (error) {
      console.error('Firebase Auth logout error:', error);
      return { success: false, error };
    }
  },

  // Update password in Firebase Auth for currently signed in user
  async updateAuthPassword(newPassword) {
    try {
      const user = auth.currentUser;
      if (user) {
        await user.updatePassword(newPassword);
        return { success: true };
      }
      return { success: false, error: 'User not logged in' };
    } catch (error) {
      console.warn('Firebase Auth updatePassword error:', error);
      return { success: false, error: error.message };
    }
  },

  // 3. Add Document to collection (auto-generates or uses provided ID)
  async addDocument(collectionName, data) {
    try {
      const payload = {
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        localTimestamp: new Date().toISOString()
      };

      if (data && data.id) {
        const docId = String(data.id);
        await db.collection(collectionName).doc(docId).set(payload, { merge: true });
        return { success: true, id: docId };
      } else {
        const docRef = await db.collection(collectionName).add(payload);
        // update with assigned id
        await docRef.update({ id: docRef.id });
        return { success: true, id: docRef.id };
      }
    } catch (error) {
      console.error(`Error adding document to ${collectionName}:`, error);
      return { success: false, error };
    }
  },

  // 4. Set or Merge Document
  async setDocument(collectionName, docId, data) {
    try {
      const payload = {
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        localTimestamp: new Date().toISOString()
      };
      await db.collection(collectionName).doc(String(docId)).set(payload, { merge: true });
      return { success: true };
    } catch (error) {
      console.error(`Error setting document in ${collectionName}:`, error);
      return { success: false, error };
    }
  },

  // 5. Update Document
  async updateDocument(collectionName, docId, data) {
    try {
      const payload = {
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        localTimestamp: new Date().toISOString()
      };
      await db.collection(collectionName).doc(String(docId)).set(payload, { merge: true });
      return { success: true };
    } catch (error) {
      console.error(`Error updating document in ${collectionName}:`, error);
      return { success: false, error };
    }
  },

  // 6. Delete Document
  async deleteDocument(collectionName, docId) {
    try {
      await db.collection(collectionName).doc(String(docId)).delete();
      return { success: true };
    } catch (error) {
      console.error(`Error deleting document from ${collectionName}:`, error);
      return { success: false, error };
    }
  },

  // 7. Realtime Sync (onSnapshot)
  initRealtimeSync(collectionName, callback) {
    try {
      return db.collection(collectionName).onSnapshot(
        (snapshot) => {
          const docs = [];
          snapshot.forEach((doc) => {
            docs.push({
              id: doc.id,
              ...doc.data()
            });
          });
          callback(docs);
        },
        (error) => {
          console.warn(`Firestore Realtime Sync error on [${collectionName}]:`, error);
        }
      );
    } catch (err) {
      console.error(`Failed to init sync on [${collectionName}]:`, err);
      return () => {};
    }
  }
};

window.FDB = FDB;
