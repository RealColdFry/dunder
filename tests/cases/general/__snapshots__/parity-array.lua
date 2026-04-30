local ____exports = {}
function ____exports.__main()
    local arr = {10, 20, 30, 40, 50}
    local sum = 0
    local i = 0
    while true do
        do
            if not (i < #arr) then
                break
            end
            sum = sum + arr[i + 1]
            i = i + 1
        end
        ::____continue_0::
    end
    return {sum = sum, len = #arr, first = arr[1], last = arr[#arr - 1 + 1]}
end
return ____exports
