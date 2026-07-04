import struct, gzip, math
import numpy as np

NILVALUE_SXP = 254
REFSXP = 255
NILSXP = 0
SYMSXP = 1
LISTSXP = 2
CHARSXP = 9
LGLSXP = 10
INTSXP = 13
REALSXP = 14
STRSXP = 16
VECSXP = 19
EXPRSXP = 20
RAWSXP = 24

NA_INT = -2147483648

class RParser:
    def __init__(self, data):
        self.data = data
        self.pos = 0
        self.reftable = []

    def read_bytes(self, n):
        b = self.data[self.pos:self.pos+n]
        self.pos += n
        return b

    def read_int(self):
        return struct.unpack_from('>i', self.data, self.pos)[0].__index__() if False else struct.unpack('>i', self.read_bytes(4))[0]

    def read_double(self):
        return struct.unpack('>d', self.read_bytes(8))[0]

    def add_ref(self, obj):
        self.reftable.append(obj)
        return obj

    def read_item(self):
        flags = self.read_int()
        return self.read_item_with_flags(flags)

    def read_item_with_flags(self, flags):
        type_ = flags & 0xFF

        if type_ == REFSXP:
            idx = flags >> 8
            if idx == 0:
                idx = self.read_int()
            return self.reftable[idx-1]

        if type_ in (NILVALUE_SXP, NILSXP):
            return None

        hasattr_ = bool(flags & 0x200)
        hastag = bool(flags & 0x400)

        if type_ == SYMSXP:
            name_item = self.read_item()
            sym = ('symbol', name_item)
            self.add_ref(sym)
            return sym

        if type_ == CHARSXP:
            length = self.read_int()
            if length == -1:
                return None
            raw = self.read_bytes(length)
            try:
                return raw.decode('utf-8')
            except UnicodeDecodeError:
                return raw.decode('latin1')

        if type_ == LISTSXP:
            node_attr = None
            if hasattr_:
                node_attr = self.read_item()
            tag = None
            if hastag:
                tag = self.read_item()
            car = self.read_item()
            cdr = self.read_item()
            return ('pairlist', tag, car, cdr, node_attr)

        if type_ in (LGLSXP, INTSXP):
            length = self.read_int()
            raw = self.read_bytes(length*4)
            arr = np.frombuffer(raw, dtype='>i4').astype(np.int64)
            obj = np.where(arr == NA_INT, np.nan, arr).tolist() if length>0 else []
            if type_ == LGLSXP:
                obj = [None if (v is None or (isinstance(v,float) and math.isnan(v))) else bool(v) for v in obj]

        elif type_ == REALSXP:
            length = self.read_int()
            raw = self.read_bytes(length*8)
            arr = np.frombuffer(raw, dtype='>f8')
            obj = arr.tolist()

        elif type_ == STRSXP:
            length = self.read_int()
            obj = [self.read_item() for _ in range(length)]

        elif type_ in (VECSXP, EXPRSXP):
            length = self.read_int()
            obj = [self.read_item() for _ in range(length)]

        elif type_ == RAWSXP:
            length = self.read_int()
            obj = self.read_bytes(length)

        else:
            raise NotImplementedError(f"Unhandled SEXP type {type_} at byte {self.pos}")

        attrs = {}
        if hasattr_:
            attrs = self.read_attr_pairlist()

        return {'value': obj, 'attrs': attrs, 'rtype': type_}

    def read_attr_pairlist(self):
        attrs = {}
        while True:
            flags = self.read_int()
            type_ = flags & 0xFF
            if type_ in (NILVALUE_SXP, NILSXP):
                break
            hasattr_ = bool(flags & 0x200)
            hastag = bool(flags & 0x400)
            if hasattr_:
                self.read_item()  # rare: attr-of-attr, discard
            tag = None
            if hastag:
                tag = self.read_item()
            car = self.read_item()
            key = tag[1] if tag else None
            attrs[key] = car
        return attrs


def load_rds(path):
    with open(path, 'rb') as f:
        raw = f.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    pos = 0
    assert raw[:2] == b'X\n'
    pos = 2
    version = struct.unpack('>i', raw[pos:pos+4])[0]; pos += 4
    writer_ver = struct.unpack('>i', raw[pos:pos+4])[0]; pos += 4
    min_reader_ver = struct.unpack('>i', raw[pos:pos+4])[0]; pos += 4
    if version == 3:
        enc_len = struct.unpack('>i', raw[pos:pos+4])[0]; pos += 4
        pos += enc_len  # native encoding string, skip

    parser = RParser(raw)
    parser.pos = pos
    obj = parser.read_item()
    return obj


def rvec_to_pyvalue(item):
    """Convert a parsed R vector item (dict with value/attrs/rtype) into a plain python list,
    resolving factors to their string labels."""
    if item is None:
        return None
    if not isinstance(item, dict):
        return item
    val = item['value']
    attrs = item.get('attrs', {})
    cls = attrs.get('class')
    if cls is not None:
        cls_val = cls['value'] if isinstance(cls, dict) else cls
        if cls_val and 'factor' in cls_val:
            levels_item = attrs.get('levels')
            levels = levels_item['value'] if isinstance(levels_item, dict) else levels_item
            out = []
            for v in val:
                if v is None or (isinstance(v, float) and math.isnan(v)):
                    out.append(None)
                else:
                    out.append(levels[int(v)-1])
            return out
    return val


def rlist_names(item):
    attrs = item.get('attrs', {})
    names_item = attrs.get('names')
    if names_item is None:
        return None
    return names_item['value'] if isinstance(names_item, dict) else names_item


def rdf_to_pandas(item):
    import pandas as pd
    names = rlist_names(item)
    cols = item['value']
    data = {}
    for name, col in zip(names, cols):
        data[name] = rvec_to_pyvalue(col)
    return pd.DataFrame(data)
