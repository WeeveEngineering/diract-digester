/**
 * Copyright reelyActive 2020
 * We believe in an open Internet of Things
 */


const DIRACT_PROXIMITY_SIGNATURE = 'ff830501';
const DIRACT_DIGEST_SIGNATURE = 'ff830511';
const DIRACT_PACKET_SIGNATURE_OFFSET = 24;
const DIRACT_DEVICES_PER_PAGE = 3;


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
  }

  /**
   * Handle the given raddec if it is DirAct-related.
   * @param {Raddec} raddec The given Raddec instance.
   */
  handleRaddec(raddec) {
    let self = this;
    let hasPackets = raddec.hasOwnProperty('packets');

    if(hasPackets) {
      raddec.packets.forEach(function(packet) {
        processPacket(self, packet);
      });
    }
  }
}


/**
 * Process the given packet, taking appropriate action if it is DirAct-related.
 * @param {DirActDigester} instance The given DirActDigester instance.
 * @param {String} packet The given packet as a hexadecimal string.
 */
function processPacket(instance, packet) {
  let signature = packet.substr(DIRACT_PACKET_SIGNATURE_OFFSET,
                                DIRACT_PROXIMITY_SIGNATURE.length);
  let isDirActProximity = (signature === DIRACT_PROXIMITY_SIGNATURE);
  let isDirActDigest = (signature === DIRACT_DIGEST_SIGNATURE);

  if(isDirActProximity && instance.handleDirActProximity) {
    processProximityPacket(instance, packet);
  }
  else if(isDirActDigest && instance.handleDirActDigest) {
    processDigestPacket(instance, packet);
  }
}


/**
 * Process the given proximity packet.
 * @param {DirActDigester} instance The given DirActDigester instance.
 * @param {String} packet The given packet as a hexadecimal string.
 */
function processProximityPacket(instance, packet) {
  let diract = {};
  let data = packet.substr(30);
  let frameLength = parseInt(data.substr(2,2), 16) & 0x1f;

  diract.cyclicCount = parseInt(data.substr(2,1), 16) >> 1;
  diract.instanceId = data.substr(4,8);
  diract.acceleration = [];
  diract.acceleration.push(toAcceleration(data.substr(12,2), true));
  diract.acceleration.push(toAcceleration(data.substr(13,2), false));
  diract.acceleration.push(toAcceleration(data.substr(15,2), true));
  diract.batteryPercentage = toBatteryPercentage(data.substr(16,2));
  diract.nearest = [];

  for(nearestIndex = 9; nearestIndex < (frameLength + 2); nearestIndex += 5) {
    let instanceId = data.substr(nearestIndex * 2, 8);
    let rssi = toRssi(data.substr(nearestIndex * 2 + 8, 2));
    diract.nearest.push( { instanceId: instanceId, rssi: rssi } );
  }

  instance.handleDirActProximity(diract);
}


/**
 * Process the given digest packet.
 * @param {DirActDigester} instance The given DirActDigester instance.
 * @param {String} packet The given packet as a hexadecimal string.
 */
function processDigestPacket(instance, packet) {
  let data = packet.substr(30);
  let frameLength = parseInt(data.substr(2,2), 16) & 0x1f;
  let pageNumber = parseInt(data.substr(2,1), 16) >> 1;
  let instanceId = data.substr(4,8);
  let isLastPage = ((parseInt(data.substr(12,1), 16) & 0x8) === 0x8);
  let digestTimestamp = parseInt(data.substr(12,6), 16) & 0x7fffff;
  let page = [];

  for(let pageIndex = 9; pageIndex < (frameLength + 2); pageIndex += 5) {
    let instanceId = data.substr(pageIndex * 2, 8);
    let count = parseInt(data.substr(pageIndex * 2 + 8, 2), 16);
    page.push( { instanceId: instanceId, count: count } );
  }

  updateDigest(instance, instanceId, digestTimestamp, isLastPage, pageNumber,
               page);
}


/**
 * Update the digest with the given page.
 * @param {DirActDigester} instance The given DirActDigester instance.
 * @param {String} instanceId The DirAct device's instance identifier.
 * @param {Number} digestTimestamp The digest timestamp.
 * @param {boolean} isLastPage Is this the last page in the digest?
 * @param {Number} pageNumber The number of the given digest page.
 * @param {Array} page The given digest page.
 */
function updateDigest(instance, instanceId, digestTimestamp, isLastPage,
                      pageNumber, page) {
  let isNewDevice = !instance.digests.has(instanceId);
  let digest;

  if(isNewDevice) {
    digest = createDigest(instanceId, digestTimestamp, isLastPage, pageNumber,
                          page);
    instance.digests.set(instanceId, digest);
  }
  else {
    digest = instance.digests.get(instanceId);
    let isNewDigest = (digest.digestTimestamp !== digestTimestamp);

    if(isNewDigest) {
      digest = createDigest(instanceId, digestTimestamp, isLastPage, 
                            pageNumber, page);
      instance.digests.set(instanceId, digest);
    }
    else if(digest.isHandled) {
      return;
    }
    else {
      addDigestPage(digest.interactions, pageNumber, page);
    }
  }

  if(isDigestComplete(digest)) {
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
 */
function createDigest(instanceId, digestTimestamp, isLastPage, pageNumber,
                      page) {
  let interactions = [];
  let numberOfInteractions = null;
  addDigestPage(interactions, pageNumber, page);
  if(isLastPage) {
    numberOfInteractions = pageNumber + page.length;
  }

  return {
      instanceId: instanceId,
      digestTimestamp: digestTimestamp,
      numberOfInteractions: numberOfInteractions,
      interactions: interactions
  };
}


/**
 * Add the given page to the given interactions table.
 * @param {Array} interactions The given interactions table.
 * @param {Number} pageNumber The number of the given digest page.
 * @param {Array} page The given digest page.
 */
function addDigestPage(interactions, pageNumber, page) {
  let offset = pageNumber * DIRACT_DEVICES_PER_PAGE;

  page.forEach(function(entry, index) {
    interactions[offset + index] = entry;
  });
}


/**
 * Test if the given digest is complete.
 * @param {Object} digest The given digest.
 */
function isDigestComplete(digest) {
  let isLastPagePending = (digest.numberOfInteractions === null);
  let entryCount = 0;

  if(isLastPagePending) {
    return false;
  }

  digest.interactions.forEach(function(entry) {
    entryCount++;
  });

  return (entryCount === digest.numberOfInteractions);
}


/**
 * Convert the given bits to battery percentage.
 * @param {String} bits The bits as a hexadecimal string.
 */
function toBatteryPercentage(bits) {
  var data = parseInt(bits, 16);
  data &= 0x3f;

  return Math.round(100 * data / 63);
}


/**
 * Convert the given twos complement hexadecimal string to acceleration in g.
 * @param {String} byte The byte as a hexadecimal string.
 * @parem {boolean} isUpper Whether the data is in the upper part or not.
 */
function toAcceleration(byte, isUpper) {
  var data = parseInt(byte, 16);
  if(isUpper) {
    data = data >> 2;
  }
  else {
    data &= 0x3f;
  }
  if(data === 32) {
    return null;
  }
  if(data > 31) {
    return (data - 64) / 16;
  }
  return data / 16;
}


/**
 * Convert the given bits to RSSI.
 * @param {String} bits The bits as a hexadecimal string.
 */
function toRssi(bits) {
  var data = parseInt(bits, 16);

  return (data & 0x3f) - 92;
}


module.exports = DirActDigester;