diract-digester
===============

Prepares diract-digest and/or diract-proximity data from a raddec stream.


Installation
------------

    npm install diract-digester


Hello diract-digester
---------------------

```javascript
const DirActDigester = require('diract-digester');
const Barnowl = require('barnowl');

let digester = new DirActDigester({
    handleDirActProximity: handleDirActProximity,
    handleDirActDigest: handleDirActDigest
});

let barnowl = new Barnowl();
barnowl.addListener( /* See barnowl documentation for data source */ );

barnowl.on('raddec', function(raddec) {
  digester.handleRaddec(raddec);
});

function handleDirActProximity(proximity) {
  console.log(proximity);
}

function handleDirActDigest(digest) {
  console.log(digest);
}
```


DirAct data format
------------------

The (real-time) DirAct proximity packet and (compiled) DirAct digest are structured as follows.

### DirAct Proximity

    {
      cyclicCount: 5,
      instanceId: '01234567',
      acceleration: [ 0.0, 0.0, 1.0 ],
      batteryPercentage: 99,
      nearest: [
        { instanceId: '0aaaaaaa', rssi: -52 },
        { instanceId: '0bbbbbbb', rssi: -61 }
      ],
      timestamp: 1589934703996
    }


### DirAct Digest

    {
      instanceId: '01234567',
      digestTimestamp: 3600,
      interactions: [
        { instanceId: '0aaaaaaa', count: 7424 },
        { instanceId: '0bbbbbbb', count: 1280 },
        { instanceId: '0ccccccc', count: 512 },
        { instanceId: '0ddddddd', count: 128 },
        { instanceId: '0eeeeeee', count: 39 },
        { instanceId: '0fffffff', count: 1 }
      ],
      timestamp: 1589934703996
    }


License
-------

MIT License

Copyright (c) 2020 [reelyActive](https://www.reelyactive.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.