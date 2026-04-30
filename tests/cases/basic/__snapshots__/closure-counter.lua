local ____exports = {}
local function makeCounter()
    local count = 0
    return function()
        count = count + 1
        return count
    end
end
local inc = makeCounter()
inc()
inc()
return ____exports
