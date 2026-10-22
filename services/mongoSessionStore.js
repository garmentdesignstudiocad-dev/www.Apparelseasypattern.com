"use strict";

const session = require("express-session");
const { MongoClient } = require("mongodb");

class MongoSessionStore extends session.Store {
  constructor(options = {}) {
    super();

    if (!options.uri) throw new Error("Mongo session URI missing");

    this.client = new MongoClient(options.uri, {
      serverSelectionTimeoutMS: 10000
    });

    this.ttlMs = 60 * 60 * 1000;
    this.collectionName = "aep_sessions";

    this.ready = this.client.connect().then(async () => {
      const db = this.client.db();

      this.collection = db.collection(this.collectionName);

      await this.collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );
    });
  }

  get(sid, callback) {
    this.ready.then(async () => {
      const document = await this.collection.findOne({
        _id: sid,
        expiresAt: { $gt: new Date() }
      });

      callback(null, document ? document.session : null);
    }).catch(callback);
  }

  set(sid, value, callback) {
    this.ready.then(async () => {
      const expiresAt = value.cookie?.expires
        ? new Date(value.cookie.expires)
        : new Date(Date.now() + this.ttlMs);

      await this.collection.updateOne(
        { _id: sid },
        {
          $set: {
            session: value,
            expiresAt
          }
        },
        { upsert: true }
      );

      callback(null);
    }).catch(callback);
  }

  destroy(sid, callback) {
    this.ready.then(async () => {
      await this.collection.deleteOne({ _id: sid });
      callback(null);
    }).catch(callback);
  }

  touch(sid, value, callback) {
    this.ready.then(async () => {
      const expiresAt = value.cookie?.expires
        ? new Date(value.cookie.expires)
        : new Date(Date.now() + this.ttlMs);

      await this.collection.updateOne(
        { _id: sid },
        { $set: { expiresAt } }
      );

      callback(null);
    }).catch(callback);
  }
}

module.exports = MongoSessionStore;
