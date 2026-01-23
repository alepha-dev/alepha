# Keyless JSON Codec Benchmark Results

## Summary

| Metric | Standard JSON | Keyless | Ratio | Improvement |
|--------|---------------|---------|-------|-------------|
| Encode | 17.73ms | 14.88ms | **0.84x** | 16% faster |
| Decode | 53.17ms | 30.29ms | **0.57x** | 43% faster |
| Size | 464 bytes | 228 bytes | **0.49x** | 51% smaller |

## Configuration

- **Iterations**: 50,000
- **Warmup**: 5,000 iterations
- **Node**: v25.2.1
- **Validation**: Disabled

## Raw Results

### Run 1
```
encode-standard: 17.723ms
encode-keyless: 14.383ms
decode-standard: 53.581ms
decode-keyless: 30.264ms
```

### Run 2
```
encode-standard: 17.82ms
encode-keyless: 15.419ms
decode-standard: 52.882ms
decode-keyless: 30.441ms
```

### Run 3
```
encode-standard: 17.636ms
encode-keyless: 14.832ms
decode-standard: 53.048ms
decode-keyless: 30.174ms
```

## Averages

| Metric | Standard | Keyless | Ratio |
|--------|----------|---------|-------|
| Encode | 17.73ms | 14.88ms | 0.84x |
| Decode | 53.17ms | 30.29ms | 0.57x |

## Size

- Standard: 464 bytes
- Keyless: 228 bytes (49.1%)
