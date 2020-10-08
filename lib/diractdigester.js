/**
 * Copyright reelyActive 2020
 * We believe in an open Internet of Things
 */

const DIRACT_PROXIMITY_SIGNATURE = "ff830501";
const DIRACT_DIGEST_SIGNATURE = "ff830511";
const DIRACT_PACKET_SIGNATURE_OFFSET = 24;
const DIRACT_DEVICES_PER_PAGE = 3;

const dotenv = require("dotenv");
dotenv.config();
const logger = require("./logger");

/**
 * DirActDigester Class
 * Prepares diract-digest and/or diract-proximity data from a raddec stream.
 * @param {Object} options The options as a JSON object.
 * @constructor
 */
class DirActDigester {
  /**
   * DirActDigester constructor
   * @param {Object} options The options as a JSON object.
   * @constructor
   */
  constructor(options) {
    options = options || {};

    this.handleDirActProximity = options.handleDirActProximity;
    this.handleDirActDigest = options.handleDirActDigest;
    this.digests = new Map();

    logger.debug({ message: "Constructor", context: { options } });
  }

  /**
   * Handle the given raddec if it is DirAct-related.
   * @param {Raddec} raddec The given Raddec instance.
   */
  handleRaddec(raddec) {
    let self = this;
    let hasPackets = raddec.hasOwnProperty("packets");

    if (hasPackets) {
      let timestamp = raddec.timestamp || Date.now();

      raddec.packets.forEach(function (packet) {
        processPacket(self, packet, timestamp);
      });
    }
  }
}

/**
 * Process the given packet, taking appropriate action if it is DirAct-related.
 * @param {DirActDigester} instance The given DirActDigester instance.
 * @param {String} packet The given packet as a hexadecimal string.
 * @param {Number} timestamp The timestamp of the raddec.
 */
function processPacket(instance, packet, timestamp) {
  let signature = packet.substr(
    DIRACT_PACKET_SIGNATURE_OFFSET,
    DIRACT_PROXIMITY_SIGNATURE.length
  );
  let isDirActProximity = signature === DIRACT_PROXIMITY_SIGNATURE;
  let isDirActDigest = signature === DIRACT_DIGEST_SIGNATURE;

  if (isDirActProximity && instance.handleDirActProximity) {
    processProximityPacket(instance, packet, timestamp);
  } else if (isDirActDigest && instance.handleDirActDigest) {
    processDigestPacket(instance, packet, timestamp);
  }
}

/**
 * Process the given proximity packet.
 * @param {DirActDigester} instance The given DirActDigester instance.
 * @param {String} packet The given packet as a hexadecimal string.
 * @param {Number} timestamp The timestamp of the raddec.
 */
function processProximityPacket(instance, packet, timestamp) {
  let diract = {};
  let data = packet.substr(30);
  let frameLength = parseInt(data.substr(2, 2), 16) & 0x1f;

  diract.cyclicCount = parseInt(data.substr(2, 1), 16) >> 1;
  diract.instanceId = data.substr(4, 8);
  diract.acceleration = [];
  diract.acceleration.push(toAcceleration(data.substr(12, 2), true));
  diract.acceleration.push(toAcceleration(data.substr(13, 2), false));
  diract.acceleration.push(toAcceleration(data.substr(15, 2), true));
  diract.batteryPercentage = toBatteryPercentage(data.substr(16, 2));
  diract.nearest = [];
  diract.timestamp = timestamp;

  for (
    let nearestIndex = 9;
    nearestIndex < frameLength + 2;
    nearestIndex += 5
  ) {
    let instanceId = data.substr(nearestIndex * 2, 8);
    let rssi = toRssi(data.substr(nearestIndex * 2 + 8, 2));
    diract.nearest.push({ instanceId: instanceId, rssi: rssi });
  }
  logger.info({ message: "processProximityPacket", context: { diract } });

  instance.handleDirActProximity(diract);
}

/**
 * Process the given digest packet.
 * @param {DirActDigester} instance The given DirActDigester instance.
 * @param {String} packet The given packet as a hexadecimal string.
 * @param {Number} timestamp The timestamp of the raddec.
 */
function processDigestPacket(instance, packet, timestamp) {
  let data = packet.substr(30);
  let frameLength = parseInt(data.substr(2, 2), 16) & 0x1f;
  let pageNumber = parseInt(data.substr(2, 1), 16) >> 1;
  let instanceId = data.substr(4, 8);
  let isLastPage = (parseInt(data.substr(12, 1), 16) & 0x8) === 0x8;
  let digestTimestamp = parseInt(data.substr(12, 6), 16) & 0x7fffff;
  let page = [];

  for (let pageIndex = 9; pageIndex < frameLength + 2; pageIndex += 5) {
    let instanceId = data.substr(pageIndex * 2, 8);
    let count = parseInt(data.substr(pageIndex * 2 + 8, 2), 16);
    if (count > 128) {
      count = (count & 0x7f) << 8;
    }
    page.push({ instanceId: instanceId, count: count });
  }

  logger.info({
    message: "processDigestPacket",
    context: {
      instance,
      instanceId,
      digestTimestamp,
      isLastPage,
      pageNumber,
      page,
      timestamp,
    },
  });

  updateDigest(
    instance,
    instanceId,
    digestTimestamp,
    isLastPage,
    pageNumber,
    page,
    timestamp
  );
}

/**
 * Update the digest with the given page.
 * @param {DirActDigester} instance The given DirActDigester instance.
 * @param {String} instanceId The DirAct device's instance identifier.
 * @param {Number} digestTimestamp The digest timestamp.
 * @param {boolean} isLastPage Is this the last page in the digest?
 * @param {Number} pageNumber The number of the given digest page.
 * @param {Array} page The given digest page.
 * @param {Number} timestamp The timestamp of the raddec.
 */
function updateDigest(
  instance,
  instanceId,
  digestTimestamp,
  isLastPage,
  pageNumber,
  page,
  timestamp
) {
  let isNewDevice = !instance.digests.has(instanceId);
  let digest;

  if (isNewDevice) {
    digest = createDigest(
      instanceId,
      digestTimestamp,
      isLastPage,
      pageNumber,
      page,
      timestamp
    );
    instance.digests.set(instanceId, digest);
  } else {
    digest = instance.digests.get(instanceId);
    let isNewDigest = digest.digestTimestamp !== digestTimestamp;

    if (isNewDigest) {
      digest = createDigest(
        instanceId,
        digestTimestamp,
        isLastPage,
        pageNumber,
        page,
        timestamp
      );
      instance.digests.set(instanceId, digest);
    } else if (digest.isHandled) {
      return;
    } else {
      addDigestPage(digest, isLastPage, pageNumber, page);
    }
  }

  if (isDigestComplete(digest)) {
    delete digest.numberOfInteractions;
    instance.handleDirActDigest(digest);
    digest.isHandled = true;
  }
}

/**
 * Create a digest with the given page.
 * @param {String} instanceId The DirAct device's instance identifier.
 * @param {Number} digestTimestamp The digest timestamp.
 * @param {boolean} isLastPage Is this the last page in the digest?
 * @param {Number} pageNumber The number of the given digest page.
 * @param {Array} page The given digest page.
 * @param {Number} timestamp The timestamp of the raddec.
 */
function createDigest(
  instanceId,
  digestTimestamp,
  isLastPage,
  pageNumber,
  page,
  timestamp
) {
  let digest = {
    instanceId: instanceId,
    digestTimestamp: digestTimestamp,
    numberOfInteractions: null,
    interactions: [],
    timestamp: timestamp,
  };
  addDigestPage(digest, isLastPage, pageNumber, page);
  logger.info({
    message: "createDigest",
    context: {
      digest,
    },
  });
  return digest;
}

/**
 * Add the given page to the given digest.
 * @param {Object} digest The given digest.
 * @param {boolean} isLastPage Is this the last page in the digest?
 * @param {Number} pageNumber The number of the given digest page.
 * @param {Array} page The given digest page.
 */
function addDigestPage(digest, isLastPage, pageNumber, page) {
  let offset = pageNumber * DIRACT_DEVICES_PER_PAGE;

  if (isLastPage) {
    digest.numberOfInteractions = offset + page.length;
  }

  page.forEach(function (entry, index) {
    digest.interactions[offset + index] = entry;
  });
}

/**
 * Test if the given digest is complete.
 * @param {Object} digest The given digest.
 */
function isDigestComplete(digest) {
  let isLastPagePending = digest.numberOfInteractions === null;
  let entryCount = 0;

  if (isLastPagePending) {
    return false;
  }

  digest.interactions.forEach(function (entry) {
    entryCount++;
  });

  return entryCount === digest.numberOfInteractions;
}

/**
 * Convert the given bits to battery percentage.
 * @param {String} bits The bits as a hexadecimal string.
 */
function toBatteryPercentage(bits) {
  var data = parseInt(bits, 16);
  data &= 0x3f;
  logger.info({
    message: "toBatteryPercentage",
    context: {
      battery: Math.round((100 * data) / 63),
    },
  });
  return Math.round((100 * data) / 63);
}

/**
 * Convert the given twos complement hexadecimal string to acceleration in g.
 * @param {String} byte The byte as a hexadecimal string.
 * @parem {boolean} isUpper Whether the data is in the upper part or not.
 */
function toAcceleration(byte, isUpper) {
  var data = parseInt(byte, 16);
  if (isUpper) {
    data = data >> 2;
  } else {
    data &= 0x3f;
  }
  if (data === 32) {
    return null;
  }
  if (data > 31) {
    return (data - 64) / 16;
  }
  logger.info({
    message: "toAcceleration",
    context: {
      byte,
      isUpper,
      data,
    },
  });
  return data / 16;
}

/**
 * Convert the given bits to RSSI.
 * @param {String} bits The bits as a hexadecimal string.
 */
function toRssi(bits) {
  var data = parseInt(bits, 16);

  logger.info({
    message: "toBatteryPercentage",
    context: {
      rssi: (data & 0x3f) - 92,
    },
  });
  return (data & 0x3f) - 92;
}

module.exports = DirActDigester;
