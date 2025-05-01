# @alepha/lock

Alepha Lock is a simple lock system for Alepha.
As Node is single-threaded, this package is intended to be used in a distributed environment (when you have multiple Node processes running)
where multiple processes or servers need to coordinate access to shared resources.

It relies on Redis by default.

## Installation

```bash
npm install @alepha/lock
```
